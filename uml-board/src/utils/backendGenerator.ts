import { construirModeloJava, type EntidadJava } from './backendModel';
import { generatePostmanCollection } from './postmanGenerator';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { NodeType, EdgeType } from './umlConstants';

type ClassNode = NodeType;
// type RelationEdge = EdgeType;

// Genera los campos de atributos simples (sin relaciones)
/**
 * Cuerpo de una entidad JPA, derivado del modelo compartido.
 *
 * Los campos simples se emiten con @Column y su nombre de columna en snake_case,
 * igual que el DDL. Las relaciones se emiten como asociaciones JPA reales
 * (@ManyToOne + @JoinColumn) y no como un Long suelto: esa es la unica forma de
 * que Hibernate cree la restriccion de clave foranea en la base de datos. La
 * regla de borrado se toma del mapeo, asi que la composicion propaga el borrado
 * y la agregacion anula la referencia, como exigen las reglas R6 y R7.
 */
function generateEntityFields(entidad: EntidadJava): string {
  const lineas: string[] = [];

  for (const campo of entidad.campos) {
    if (campo.clase === 'id') {
      lineas.push('    @Id');
      lineas.push('    @GeneratedValue(strategy = GenerationType.IDENTITY)');
      lineas.push(`    private Long ${campo.javaName};`);
      lineas.push('');
      continue;
    }

    if (campo.clase === 'fk') {
      const constraint = `fk_${entidad.tabla}_${campo.columna}`;
      // EAGER para que la respuesta JSON incluya la entidad relacionada sin
      // necesidad de una sesion abierta: simplifica las pruebas con Postman.
      lineas.push('    @ManyToOne(fetch = FetchType.EAGER)');
      const partes = [`name = "${campo.columna}"`, `referencedColumnName = "id"`];
      if (!campo.nulo) partes.push('nullable = false');
      if (campo.unica) partes.push('unique = true');
      partes.push(`foreignKey = @ForeignKey(name = "${constraint}")`);
      lineas.push(`    @JoinColumn(${partes.join(', ')})`);
      if (campo.onDelete === 'CASCADE') {
        lineas.push('    @OnDelete(action = OnDeleteAction.CASCADE)');
      } else if (campo.onDelete === 'SET NULL') {
        lineas.push('    @OnDelete(action = OnDeleteAction.SET_NULL)');
      }
      lineas.push(`    private ${campo.javaType} ${campo.javaName};`);
      lineas.push('');
      continue;
    }

    lineas.push(`    @Column(name = "${campo.columna}"${campo.unica ? ', unique = true' : ''}${campo.nulo ? '' : ', nullable = false'})`);
    lineas.push(`    private ${campo.javaType} ${campo.javaName};`);
    lineas.push('');
  }

  return lineas.join('\n').trimEnd();
}

function generateEntity(entidad: EntidadJava): string {
  const usaFecha = entidad.campos.some(c => c.javaType === 'LocalDate');
  const usaFechaHora = entidad.campos.some(c => c.javaType === 'LocalDateTime');
  const usaOnDelete = entidad.campos.some(
    c => c.clase === 'fk' && (c.onDelete === 'CASCADE' || c.onDelete === 'SET NULL')
  );

  const imports = [
    'import jakarta.persistence.*;',
    'import lombok.Data;',
    ...(usaOnDelete
      ? ['import org.hibernate.annotations.OnDelete;', 'import org.hibernate.annotations.OnDeleteAction;']
      : []),
    ...(usaFecha ? ['import java.time.LocalDate;'] : []),
    ...(usaFechaHora ? ['import java.time.LocalDateTime;'] : []),
  ].join('\n');

  return `
package com.example.demo.entity;

${imports}

@Entity
@Data
@Table(name = "${entidad.tabla}")
public class ${entidad.label} {

${generateEntityFields(entidad)}
}
`.trim();
}

function generateRepository(cls: ClassNode): string {
  return `
package com.example.demo.repository;

import com.example.demo.entity.${cls.label};
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ${cls.label}Repository extends JpaRepository<${cls.label}, Long> {}
`.trim();
}

function generateService(cls: ClassNode): string {
  return `
package com.example.demo.service;

import com.example.demo.entity.${cls.label};
import com.example.demo.repository.${cls.label}Repository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class ${cls.label}Service {

    private final ${cls.label}Repository repo;

    @Autowired
    public ${cls.label}Service(${cls.label}Repository repo) {
        this.repo = repo;
    }

    public List<${cls.label}> findAll() { return repo.findAll(); }
    public ${cls.label} findById(Long id) { return repo.findById(id).orElse(null); }
    public ${cls.label} save(${cls.label} entity) { return repo.save(entity); }
    public void delete(Long id) { repo.deleteById(id); }
}
`.trim();
}

function generateController(cls: ClassNode): string {
  const baseUrl = cls.label.toLowerCase() + 's';
  return `
package com.example.demo.controller;

import com.example.demo.entity.${cls.label};
import com.example.demo.service.${cls.label}Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/${baseUrl}")
public class ${cls.label}Controller {

    private final ${cls.label}Service service;

    @Autowired
    public ${cls.label}Controller(${cls.label}Service service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<List<${cls.label}>> getAll() { return new ResponseEntity<>(service.findAll(), HttpStatus.OK); }

    @GetMapping("/{id}")
    public ResponseEntity<${cls.label}> getById(@PathVariable Long id) {
        ${cls.label} obj = service.findById(id);
        if(obj != null) return new ResponseEntity<>(obj, HttpStatus.OK);
        return ResponseEntity.notFound().build();
    }

    @PostMapping
    public ResponseEntity<${cls.label}> create(@RequestBody ${cls.label} obj) { return new ResponseEntity<>(service.save(obj), HttpStatus.CREATED); }

    @PutMapping("/{id}")
    public ResponseEntity<${cls.label}> update(@PathVariable Long id, @RequestBody ${cls.label} obj) {
        ${cls.label} updated = service.findById(id);
        if(updated != null) {
            obj.setId(updated.getId());
            return new ResponseEntity<>(service.save(obj), HttpStatus.OK);
        }
        return ResponseEntity.notFound().build();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
`.trim();
}

// Tipo para definir las opciones de backend
type BackendOption = 'h2-embedded' | 'postgresql-docker';

// Función para mostrar el diálogo de selección
function showBackendOptionDialog(): Promise<BackendOption | null> {
  return new Promise(resolve => {
    const dialog = document.createElement('div');
    dialog.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.8);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

    dialog.innerHTML = `
            <div style="
                background: white;
                padding: 30px;
                border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                max-width: 500px;
                width: 90%;
            ">
                <h2 style="margin: 0 0 20px 0; color: #333; text-align: center;">
                    🚀 Seleccionar Tipo de Backend
                </h2>
                <div style="margin-bottom: 30px;">
                    <div style="
                        border: 2px solid #e0e0e0;
                        border-radius: 8px;
                        padding: 20px;
                        margin-bottom: 15px;
                        cursor: pointer;
                        transition: all 0.3s ease;
                    " data-option="h2-embedded">
                        <h3 style="margin: 0 0 10px 0; color: #2196F3;">
                            💾 H2 Embebido (Desarrollo Rápido)
                        </h3>
                        <p style="margin: 0; color: #666; font-size: 14px;">
                            • Base de datos en memoria<br>
                            • Sin configuración adicional<br>
                            • Ideal para desarrollo y testing<br>
                            • Reinicia con cada ejecución
                        </p>
                    </div>
                    <div style="
                        border: 2px solid #e0e0e0;
                        border-radius: 8px;
                        padding: 20px;
                        cursor: pointer;
                        transition: all 0.3s ease;
                    " data-option="postgresql-docker">
                        <h3 style="margin: 0 0 10px 0; color: #4CAF50;">
                            🐘 PostgreSQL + Docker (Producción)
                        </h3>
                        <p style="margin: 0; color: #666; font-size: 14px;">
                            • PostgreSQL en contenedor Docker<br>
                            • Datos persistentes<br>
                            • Configuración lista para producción<br>
                            • Incluye docker-compose.yml
                        </p>
                    </div>
                </div>
                <div style="display: flex; gap: 15px; justify-content: center;">
                    <button id="cancelBtn" style="
                        padding: 12px 24px;
                        border: 2px solid #ccc;
                        background: white;
                        color: #666;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: 500;
                    ">
                        ❌ Cancelar
                    </button>
                </div>
            </div>
        `;

    document.body.appendChild(dialog);

    // Agregar efectos hover
    const options = dialog.querySelectorAll('[data-option]');
    options.forEach(option => {
      option.addEventListener('mouseenter', () => {
        (option as HTMLElement).style.borderColor = '#2196F3';
        (option as HTMLElement).style.backgroundColor = '#f8f9ff';
      });
      option.addEventListener('mouseleave', () => {
        (option as HTMLElement).style.borderColor = '#e0e0e0';
        (option as HTMLElement).style.backgroundColor = 'white';
      });
      option.addEventListener('click', () => {
        const selectedOption = (option as HTMLElement).getAttribute('data-option') as BackendOption;
        document.body.removeChild(dialog);
        resolve(selectedOption);
      });
    });

    // Botón cancelar
    dialog.querySelector('#cancelBtn')?.addEventListener('click', () => {
      document.body.removeChild(dialog);
      resolve(null);
    });

    // Cerrar con Escape
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', handleKeydown);
        document.body.removeChild(dialog);
        resolve(null);
      }
    };
    document.addEventListener('keydown', handleKeydown);
  });
}

function generateApplicationProperties(option: BackendOption): string {
  if (option === 'h2-embedded') {
    return `# Configuración H2 Embebido
spring.datasource.url=jdbc:h2:mem:testdb
spring.datasource.driver-class-name=org.h2.Driver
spring.datasource.username=sa
spring.datasource.password=

# Configuración JPA/Hibernate
spring.jpa.hibernate.ddl-auto=create-drop
spring.jpa.show-sql=true
spring.jpa.properties.hibernate.format_sql=true

# Consola H2 (desarrollo)
spring.h2.console.enabled=true
spring.h2.console.path=/h2-console

# Puerto del servidor
server.port=8080
`;
  } else {
    return `# Configuración PostgreSQL con Docker
spring.datasource.url=jdbc:postgresql://localhost:5432/demo
spring.datasource.driver-class-name=org.postgresql.Driver
spring.datasource.username=postgres
spring.datasource.password=postgres

# Configuración JPA/Hibernate
spring.jpa.hibernate.ddl-auto=create-drop
spring.jpa.show-sql=true
spring.jpa.properties.hibernate.format_sql=true
spring.jpa.properties.hibernate.hbm2ddl.create_namespaces=true

# IMPORTANTE: Habilitar foreign keys para CASCADE DELETE
spring.jpa.properties.hibernate.globally_quoted_identifiers=true
spring.jpa.properties.hibernate.physical_naming_strategy=org.hibernate.boot.model.naming.PhysicalNamingStrategyStandardImpl

# Puerto del servidor
server.port=8080
`;
  }
}

function generateDockerFiles(): { dockerCompose: string; dockerfile: string } {
  const dockerCompose = `version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: demo-postgres
    environment:
      POSTGRES_DB: demo
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - demo-network

  app:
    build: .
    container_name: demo-app
    depends_on:
      - postgres
    ports:
      - "8080:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/demo
      SPRING_DATASOURCE_USERNAME: postgres
      SPRING_DATASOURCE_PASSWORD: postgres
    networks:
      - demo-network

volumes:
  postgres_data:

networks:
  demo-network:
    driver: bridge
`;

  const dockerfile = `FROM openjdk:17-jdk-slim

WORKDIR /app

COPY target/demo-0.0.1-SNAPSHOT.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
`;

  return { dockerCompose, dockerfile };
}

function generateReadme(option: BackendOption): string {
  if (option === 'h2-embedded') {
    return `# Proyecto Spring Boot con H2 Embebido

## ✅ Configuración H2 en Memoria

Este proyecto usa H2 como base de datos embebida para desarrollo rápido.

### 🚀 Ejecutar el Proyecto:

1. \`mvn clean install\`
2. \`mvn spring-boot:run\`
3. Accede a: \`http://localhost:8080/h2-console\`

### 📊 Consola H2:
- **JDBC URL**: \`jdbc:h2:mem:testdb\`
- **Usuario**: \`sa\`
- **Contraseña**: (vacía)

### 🔗 Endpoints API:
- Swagger UI: \`http://localhost:8080/swagger-ui.html\`
- API Docs: \`http://localhost:8080/v3/api-docs\`

### ✅ Características:
- Base de datos en memoria (reinicia con cada ejecución)
- Borrado en cascada automático
- Configuración mínima
- Ideal para desarrollo y testing
`;
  } else {
    return `# Proyecto Spring Boot con PostgreSQL + Docker

## 🐘 Configuración PostgreSQL Containerizada

Este proyecto usa PostgreSQL en Docker para un entorno de desarrollo completo.

### 🚀 Ejecutar el Proyecto:

#### Opción 1: Solo Base de Datos en Docker
1. \`docker-compose up -d postgres\`
2. \`mvn clean install\`
3. \`mvn spring-boot:run\`

#### Opción 2: Todo en Docker
1. \`mvn clean install\`
2. \`docker-compose up --build\`

### 📊 Acceso a la Base de Datos:
- **Host**: \`localhost:5432\`
- **Base de Datos**: \`demo\`
- **Usuario**: \`postgres\`
- **Contraseña**: \`postgres\`

### 🔗 Endpoints API:
- Swagger UI: \`http://localhost:8080/swagger-ui.html\`
- API Docs: \`http://localhost:8080/v3/api-docs\`

### ✅ Características:
- PostgreSQL 15 en Docker
- Datos persistentes
- Borrado en cascada automático
- Configuración lista para producción

### 🛑 Detener:
\`docker-compose down\`

### 🗑️ Limpiar Datos:
\`docker-compose down -v\`
`;
  }
}

function generatePomXml(option: BackendOption): string {
  const h2Dependency =
    option === 'h2-embedded'
      ? `        <!-- H2: Base de datos en memoria para desarrollo -->
        <dependency>
            <groupId>com.h2database</groupId>
            <artifactId>h2</artifactId>
            <scope>runtime</scope>
        </dependency>`
      : '';

  const postgresqlDependency =
    option === 'postgresql-docker'
      ? `        <!-- PostgreSQL: Base de datos para producción -->
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>`
      : '';

  return `
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
                             http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.example</groupId>
    <artifactId>demo</artifactId>
    <version>0.0.1-SNAPSHOT</version>
    <packaging>jar</packaging>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.3.3</version>
        <relativePath/>
    </parent>

    <properties>
        <java.version>17</java.version>
    </properties>

    <dependencies>
        <!-- Spring Boot Starters -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        
        <!-- Base de Datos -->
${h2Dependency}${postgresqlDependency}
        
        <!-- Herramientas -->
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>
        
        <!-- API Documentation -->
        <dependency>
            <groupId>org.springdoc</groupId>
            <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
            <version>2.2.0</version>
        </dependency>
        
        <!-- Testing -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
                <configuration>
                    <excludes>
                        <exclude>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                        </exclude>
                    </excludes>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
`.trim();
}

export async function generarBackend(nodes: NodeType[], edges: EdgeType[], boardName?: string) {
  // Mostrar diálogo de selección
  const selectedOption = await showBackendOptionDialog();
  if (!selectedOption) {
    console.log('❌ Generación de backend cancelada');
    return;
  }

  console.log(
    `🔧 Generando backend Spring Boot (${selectedOption === 'h2-embedded' ? 'H2 Embebido' : 'PostgreSQL + Docker'})${boardName ? ` para "${boardName}"` : ''}...`
  );
  console.log(`📊 Clases detectadas: ${nodes.length}`);
  console.log(`🔗 Relaciones detectadas: ${edges.length}`);

  const zip = new JSZip();

  // Todas las clases (incluyendo asociativas)
  const classes = nodes;

  // Carpeta base del proyecto Spring Boot
  const basePath = 'spring-crud/src/main/java/com/example/demo';
  const entitiesFolder = zip.folder(`${basePath}/entity`);
  const repositoriesFolder = zip.folder(`${basePath}/repository`);
  const servicesFolder = zip.folder(`${basePath}/service`);
  const controllersFolder = zip.folder(`${basePath}/controller`);

  // Crear carpeta de recursos y configuración según la opción
  const resourcesFolder = zip.folder('spring-crud/src/main/resources');
  resourcesFolder?.file('application.properties', generateApplicationProperties(selectedOption));

  // Generar archivos Docker si es PostgreSQL
  if (selectedOption === 'postgresql-docker') {
    const dockerFiles = generateDockerFiles();
    zip.file('spring-crud/docker-compose.yml', dockerFiles.dockerCompose);
    zip.file('spring-crud/Dockerfile', dockerFiles.dockerfile);

    // Agregar script de inicio para PostgreSQL
    zip.file(
      'spring-crud/start-postgres.sh',
      `#!/bin/bash
echo "🐘 Iniciando PostgreSQL con Docker..."
docker-compose up -d postgres
echo "✅ PostgreSQL iniciado en puerto 5432"
echo "📊 Credenciales:"
echo "   Host: localhost:5432"
echo "   Database: demo"
echo "   User: postgres"
echo "   Password: postgres"
`
    );
  }

  // README con instrucciones específicas
  zip.file('spring-crud/README.md', generateReadme(selectedOption));

  // El modelo Java se deriva del mismo mapeo objeto-relacional que produce el DDL,
  // para que el backend y el esquema documentado no puedan divergir.
  const modelo = construirModeloJava(nodes, edges);

  if (modelo.advertencias.length > 0) {
    console.warn('[backend] advertencias del mapeo:', modelo.advertencias);
  }

  const porLabel = new Map(modelo.entidades.map(e => [e.label, e]));

  // Crear archivos Java de entidades, repositorios, servicios y controladores
  classes.forEach(cls => {
    const entidad = porLabel.get(cls.label);
    if (!entidad) return; // sin tabla mapeada no hay entidad que generar
    entitiesFolder?.file(`${cls.label}.java`, generateEntity(entidad));
    repositoriesFolder?.file(`${cls.label}Repository.java`, generateRepository(cls));
    servicesFolder?.file(`${cls.label}Service.java`, generateService(cls));
    controllersFolder?.file(`${cls.label}Controller.java`, generateController(cls));
  });

  // Crear clase principal DemoApplication.java
  const mainFolder = zip.folder(basePath);
  mainFolder?.file(
    'DemoApplication.java',
    `
package com.example.demo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class DemoApplication {

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }
}
`.trim()
  );

  // Crear pom.xml según la opción seleccionada
  zip.file('spring-crud/pom.xml', generatePomXml(selectedOption));

  // Generar archivo de colección Postman con endpoints CRUD
  zip.file(
    'spring-crud/DemoAPI.postman_collection.json',
    generatePostmanCollection(modelo)
  );

  if (modelo.advertencias.length > 0) {
    // Se avisa despues de generar, no antes: lo generado sigue siendo util.
    setTimeout(
      () =>
        alert(
          'El backend se genero, pero hay algo para revisar en el diagrama:\n\n' +
            modelo.advertencias.map(a => `\u2022 ${a}`).join('\n\n')
        ),
      400
    );
  }

  const projectType = selectedOption === 'h2-embedded' ? 'H2' : 'PostgreSQL-Docker';
  const fileName = `spring-crud-${projectType.toLowerCase()}.zip`;

  console.log(
    `✅ Backend Spring Boot (${projectType}) generado exitosamente${boardName ? ` para "${boardName}"` : ''}`
  );
  console.log(`📦 Archivo de descarga: ${fileName}`);

  // Descargar proyecto completo
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, fileName);
}
