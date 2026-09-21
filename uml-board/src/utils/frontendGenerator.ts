/* eslint-disable no-useless-escape */
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { NodeType, EdgeType } from './umlConstants';

// Utilidades
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function mapDartType(type: string): string {
  switch (type) {
    case 'Integer':
      return 'int';
    case 'Float':
      return 'double';
    case 'Boolean':
      return 'bool';
    case 'Date':
      return 'DateTime';
    case 'String':
      return 'String';
    default:
      return 'String';
  }
}

// Obtiene el primer atributo después del ID para usar como clave sustituta
function getDisplayAttribute(className: string, nodes: NodeType[]): string {
  const targetClass = nodes.find(node => node.label === className);
  if (!targetClass || !targetClass.attributes) return 'nombre'; // fallback

  const nonIdAttributes = targetClass.attributes.filter(attr => attr.name !== 'id');
  return nonIdAttributes.length > 0 ? nonIdAttributes[0].name : 'nombre';
}

// Detecta si una clase tiene relaciones muchos-a-muchos a través de entidades asociativas
function getManyToManyRelations(
  cls: NodeType,
  nodes: NodeType[],
  edges: EdgeType[]
): Array<{
  associativeEntity: NodeType;
  relatedEntity: NodeType;
  isMainEntity: boolean;
}> {
  const manyToManyRelations: Array<{
    associativeEntity: NodeType;
    relatedEntity: NodeType;
    isMainEntity: boolean;
  }> = [];

  // Buscar entidades asociativas que están conectadas a esta clase
  const associativeEntities = nodes.filter(node => node.asociativa);

  associativeEntities.forEach(assocEntity => {
    // Verificar si esta entidad asociativa está conectada a la clase actual
    const edgeToAssoc = edges.find(
      edge =>
        (edge.source === cls.id && edge.target === assocEntity.id) ||
        (edge.source === assocEntity.id && edge.target === cls.id)
    );

    if (edgeToAssoc) {
      // Buscar la otra entidad conectada a la misma entidad asociativa
      const otherEdges = edges.filter(
        edge =>
          (edge.source === assocEntity.id || edge.target === assocEntity.id) &&
          edge.source !== cls.id &&
          edge.target !== cls.id
      );

      otherEdges.forEach(otherEdge => {
        const relatedEntityId =
          otherEdge.source === assocEntity.id ? otherEdge.target : otherEdge.source;
        const relatedEntity = nodes.find(node => node.id === relatedEntityId && !node.asociativa);

        if (relatedEntity) {
          // Determinar cuál es la entidad principal (ID menor)
          const isMainEntity = cls.id < relatedEntity.id;

          manyToManyRelations.push({
            associativeEntity: assocEntity,
            relatedEntity,
            isMainEntity,
          });
        }
      });
    }
  });

  return manyToManyRelations;
}

// Obtiene campos foráneos para una clase
function getForeignKeyFields(
  cls: NodeType,
  nodes: NodeType[],
  edges: EdgeType[]
): Array<{ fieldName: string; className: string }> {
  const foreignKeys: Array<{ fieldName: string; className: string }> = [];

  // Obtener nombres de atributos existentes para evitar duplicados
  const existingAttributeNames = new Set((cls.attributes || []).map(attr => attr.name));

  // Para clases asociativas, agregar foráneas a las dos clases relacionadas
  if (cls.asociativa && cls.relaciona) {
    console.log(`🔧 Procesando entidad asociativa (frontend): ${cls.label}`);
    console.log(`   Relaciona: [${cls.relaciona.join(', ')}]`);
    console.log(`   Atributos existentes: [${Array.from(existingAttributeNames).join(', ')}]`);

    cls.relaciona.forEach(relId => {
      // Buscar primero por ID, luego por nombre si no se encuentra
      let relClass = nodes.find(n => n.id === relId);

      // Si no se encuentra por ID, buscar por nombre (para entidades importadas)
      if (!relClass) {
        relClass = nodes.find(n => n.label === relId);
      }

      if (relClass) {
        const fieldName = relClass.label.charAt(0).toLowerCase() + relClass.label.slice(1) + 'Id';

        // Solo agregar si no existe ya como atributo (para entidades importadas)
        if (!existingAttributeNames.has(fieldName)) {
          console.log(`   ✅ Agregando FK (frontend): ${fieldName} → ${relClass.label}`);
          foreignKeys.push({ fieldName, className: relClass.label });
        } else {
          console.log(
            `   ⏭️ Saltando FK ya existente (frontend): ${fieldName} → ${relClass.label}`
          );
        }
      } else {
        console.warn(`❌ No se encontró clase relacionada (frontend) para ID/nombre: ${relId}`);
      }
    });
  }

  // Herencia: el campo foráneo va en la clase hija
  edges
    .filter(r => r.tipo === 'herencia' && r.source === cls.id)
    .forEach(rel => {
      const parentClass = nodes.find(c => c.id === rel.target && !c.asociativa);
      if (parentClass) {
        const fieldName =
          parentClass.label.charAt(0).toLowerCase() + parentClass.label.slice(1) + 'Id';
        if (!existingAttributeNames.has(fieldName)) {
          foreignKeys.push({ fieldName, className: parentClass.label });
        }
      }
    });

  // Otras relaciones: agregar foráneas por cada relación donde esta clase es destino
  const incomingRelations = edges.filter(
    r => r.target === cls.id && ['asociacion', 'agregacion', 'composicion'].includes(r.tipo)
  );

  const added = new Set<string>();
  incomingRelations.forEach(rel => {
    const originClass = nodes.find(c => c.id === rel.source && !c.asociativa);
    if (originClass) {
      const fieldName =
        originClass.label.charAt(0).toLowerCase() + originClass.label.slice(1) + 'Id';
      if (!added.has(fieldName) && !existingAttributeNames.has(fieldName)) {
        foreignKeys.push({ fieldName, className: originClass.label });
        added.add(fieldName);
      }
    }
  });

  return foreignKeys;
}

// Genera pubspec.yaml
function generatePubspecYaml(): string {
  return `name: flutter_mvp
description: A Flutter CRUD project generated automatically

publish_to: 'none'

version: 1.0.0+1

environment:
  sdk: '>=3.0.0 <4.0.0'
  flutter: ">=3.10.0"

dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.2
  http: ^1.1.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^2.0.0

flutter:
  uses-material-design: true
`;
}

// Genera main.dart
function generateMainDart(classes: NodeType[]): string {
  const routes = classes
    .map(cls => {
      const className = cls.label.toLowerCase();
      return `      '/${className}': (context) => ${capitalizeFirst(cls.label)}ListScreen(),`;
    })
    .join('\n');

  const imports = classes
    .map(cls => {
      const className = cls.label.toLowerCase();
      return `import 'screens/${className}/${className}_list_screen.dart';`;
    })
    .join('\n');

  return `import 'package:flutter/material.dart';
${imports}
import 'widgets/app_drawer.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Flutter CRUD Demo',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
        useMaterial3: true,
      ),
      home: const HomeScreen(),
      routes: {
${routes}
      },
    );
  }
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('CRUD Demo'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
      ),
      drawer: const AppDrawer(),
      body: const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.dashboard, size: 80, color: Colors.grey),
            SizedBox(height: 16),
            Text(
              'Bienvenido al Sistema CRUD',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
            ),
            SizedBox(height: 8),
            Text(
              'Selecciona una entidad del menú lateral',
              style: TextStyle(fontSize: 16, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }
}
`;
}

// Genera modelo para una clase específica
function generateModelForClass(cls: NodeType, nodes: NodeType[], edges: EdgeType[]): string {
  const className = capitalizeFirst(cls.label);

  // Obtener todas las claves foráneas que deberían estar
  const foreignKeys = getForeignKeyFields(cls, nodes, edges);

  // Atributos propios de la clase (excluyendo 'id')
  const ownAttributes = (cls.attributes || []).filter(attr => attr.name !== 'id');

  // Crear un conjunto unificado de todos los campos únicos
  const allFieldsSet = new Set<string>();
  const fieldInfoMap = new Map<string, { isAttribute: boolean; attr?: any; fk?: any }>(); // eslint-disable-line @typescript-eslint/no-explicit-any

  // Agregar ID primero
  allFieldsSet.add('id');
  fieldInfoMap.set('id', { isAttribute: false });

  // Agregar atributos propios
  ownAttributes.forEach(attr => {
    allFieldsSet.add(attr.name);
    fieldInfoMap.set(attr.name, { isAttribute: true, attr });
  });

  // Agregar FK solo si no existen ya como atributos
  foreignKeys.forEach(fk => {
    if (!allFieldsSet.has(fk.fieldName)) {
      allFieldsSet.add(fk.fieldName);
      fieldInfoMap.set(fk.fieldName, { isAttribute: false, fk });
    }
  });

  const allFields = Array.from(allFieldsSet);

  console.log(`🔧 Generando modelo ${className}:`);
  console.log(`   Atributos de entidad: [${ownAttributes.map(a => a.name).join(', ')}]`);
  console.log(`   FK detectadas: [${foreignKeys.map(fk => fk.fieldName).join(', ')}]`);
  console.log(`   Campos finales únicos: [${allFields.join(', ')}]`);

  const constructorParams = allFields
    .map(field => {
      if (field === 'id') return 'required this.id';
      const fieldInfo = fieldInfoMap.get(field);
      if (fieldInfo?.isAttribute) {
        return `required this.${field}`;
      }
      return `this.${field}`;
    })
    .join(',\n    ');

  const fieldDeclarations = allFields
    .map(field => {
      if (field === 'id') return '  final int id;';
      const fieldInfo = fieldInfoMap.get(field);
      if (fieldInfo?.isAttribute && fieldInfo.attr) {
        return `  final ${mapDartType(fieldInfo.attr.datatype)} ${field};`;
      }
      return `  final int? ${field};`;
    })
    .join('\n');

  const fromJsonFields = allFields
    .map(field => {
      if (field === 'id') return "      id: json['id'] as int";
      const fieldInfo = fieldInfoMap.get(field);
      if (fieldInfo?.isAttribute && fieldInfo.attr) {
        const dartType = mapDartType(fieldInfo.attr.datatype);
        if (dartType === 'DateTime') {
          return `      ${field}: DateTime.parse(json['${field}'] as String)`;
        }
        return `      ${field}: json['${field}'] as ${dartType}`;
      }
      return `      ${field}: json['${field}'] as int?`;
    })
    .join(',\n');

  const toJsonFields = allFields
    .map(field => {
      const fieldInfo = fieldInfoMap.get(field);
      if (
        fieldInfo?.isAttribute &&
        fieldInfo.attr &&
        mapDartType(fieldInfo.attr.datatype) === 'DateTime'
      ) {
        return `      '${field}': ${field}.toIso8601String()`;
      }
      return `      '${field}': ${field}`;
    })
    .join(',\n');

  return `class ${className} {
${fieldDeclarations}

  ${className}({
    ${constructorParams},
  });

  factory ${className}.fromJson(Map<String, dynamic> json) {
    return ${className}(
${fromJsonFields},
    );
  }

  Map<String, dynamic> toJson() {
    return {
${toJsonFields},
    };
  }
}
`;
}

// Genera servicio para una clase específica
function generateServiceForClass(cls: NodeType): string {
  const className = capitalizeFirst(cls.label);
  const endpoint = cls.label.toLowerCase() + 's';

  return `import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/${cls.label.toLowerCase()}_model.dart';
import '../config/api_config.dart';

class ${className}Service {
  Future<List<${className}>> getAll() async {
    try {
      final response = await http.get(
        Uri.parse(ApiConfig.endpoint('${endpoint}')),
        headers: ApiConfig.headers,
      ).timeout(ApiConfig.timeout);

      if (response.statusCode == 200) {
        final List<dynamic> jsonList = json.decode(response.body);
        return jsonList.map((json) => ${className}.fromJson(json)).toList();
      } else {
        throw Exception('Failed to load ${endpoint}: \${response.statusCode}');
      }
    } catch (e) {
      print('Error loading ${endpoint}: \$e');
      return [];
    }
  }

  Future<${className}?> getById(int id) async {
    try {
      final response = await http.get(
        Uri.parse(ApiConfig.endpoint('${endpoint}/\$id')),
        headers: ApiConfig.headers,
      ).timeout(ApiConfig.timeout);

      if (response.statusCode == 200) {
        return ${className}.fromJson(json.decode(response.body));
      } else {
        print('Error getting ${cls.label.toLowerCase()} \$id: \${response.statusCode}');
        return null;
      }
    } catch (e) {
      print('Error getting ${cls.label.toLowerCase()} \$id: \$e');
      return null;
    }
  }

  Future<${className}?> create(${className} item) async {
    try {
      final response = await http.post(
        Uri.parse(ApiConfig.endpoint('${endpoint}')),
        headers: ApiConfig.headers,
        body: json.encode(item.toJson()),
      ).timeout(ApiConfig.timeout);

      if (response.statusCode == 201) {
        return ${className}.fromJson(json.decode(response.body));
      } else {
        throw Exception('Failed to create ${cls.label.toLowerCase()}: \${response.statusCode}');
      }
    } catch (e) {
      print('Error creating ${cls.label.toLowerCase()}: \$e');
      return item; // Devuelve el item original para modo offline
    }
  }

  Future<${className}?> update(${className} item) async {
    try {
      final response = await http.put(
        Uri.parse(ApiConfig.endpoint('${endpoint}/\${item.id}')),
        headers: ApiConfig.headers,
        body: json.encode(item.toJson()),
      ).timeout(ApiConfig.timeout);

      if (response.statusCode == 200) {
        return ${className}.fromJson(json.decode(response.body));
      } else {
        throw Exception('Failed to update ${cls.label.toLowerCase()}: \${response.statusCode}');
      }
    } catch (e) {
      print('Error updating ${cls.label.toLowerCase()}: \$e');
      return item; // Devuelve el item original para modo offline
    }
  }

  Future<bool> delete(int id) async {
    try {
      final response = await http.delete(
        Uri.parse(ApiConfig.endpoint('${endpoint}/\$id')),
        headers: ApiConfig.headers,
      ).timeout(ApiConfig.timeout);

      return response.statusCode == 200 || response.statusCode == 204;
    } catch (e) {
      print('Error deleting ${cls.label.toLowerCase()} \$id: \$e');
      return false;
    }
  }
  
  // Método helper para verificar conectividad con el backend
  Future<bool> checkConnection() async {
    try {
      final response = await http.get(
        Uri.parse(ApiConfig.healthCheck()),
        headers: ApiConfig.headers,
      ).timeout(const Duration(seconds: 5));
      
      return response.statusCode == 200;
    } catch (e) {
      print('Backend connection failed: \$e');
      return false;
    }
  }
}
`;
}

// Genera pantalla de lista para una clase
function generateListScreen(cls: NodeType, nodes: NodeType[], edges: EdgeType[]): string {
  const className = capitalizeFirst(cls.label);
  const endpoint = cls.label.toLowerCase();
  const ownAttributes = (cls.attributes || []).filter(attr => attr.name !== 'id');
  const foreignKeys = getForeignKeyFields(cls, nodes, edges);
  const manyToManyRelations = getManyToManyRelations(cls, nodes, edges).filter(
    rel => rel.isMainEntity
  );

  // Generar filas de detalles para atributos propios
  const ownAttributeRows = ownAttributes
    .map(attr => {
      const label = capitalizeFirst(attr.name);
      const dartType = mapDartType(attr.datatype);

      if (dartType === 'DateTime') {
        return `        _buildDetailRow('${label}', item.${attr.name}.toString().substring(0, 16)),`;
      } else {
        return `        _buildDetailRow('${label}', item.${attr.name}.toString()),`;
      }
    })
    .join('\n');

  // Generar filas de detalles para claves foráneas
  const foreignKeyRows = foreignKeys
    .map(fk => {
      const label = capitalizeFirst(fk.fieldName.replace('Id', ''));
      // const displayAttr = getDisplayAttribute(fk.className, nodes);
      return `        _buildDetailRow('${label}', item.${fk.fieldName} != null ? '\${item.${fk.fieldName}} - \${_get${fk.className}Display(item.${fk.fieldName}!)}' : 'N/A'),`;
    })
    .join('\n');

  // Combinar todas las filas
  const allDetailRows = [ownAttributeRows, foreignKeyRows]
    .filter(rows => rows.length > 0)
    .join('\n');
  const detailRowsCode = allDetailRows || '        // No hay atributos adicionales';

  // Generar botones adicionales para relaciones muchos-a-muchos
  const manyToManyButtons = manyToManyRelations
    .map(rel => {
      const assocClassName = capitalizeFirst(rel.associativeEntity.label);
      return `                                IconButton(
                                  icon: const Icon(Icons.list_alt, color: Colors.green),
                                  onPressed: () => _navigateToDetails(item.id, '${rel.associativeEntity.label}'),
                                  tooltip: 'Ver ${assocClassName}s',
                                ),`;
    })
    .join('\n');

  const actionButtons = `                                IconButton(
                                  icon: const Icon(Icons.edit, color: Colors.blue),
                                  onPressed: () => _navigateToForm(item),
                                  tooltip: 'Editar',
                                ),
                                IconButton(
                                  icon: const Icon(Icons.delete, color: Colors.red),
                                  onPressed: () => _showDeleteDialog(item.id),
                                  tooltip: 'Eliminar',
                                ),${manyToManyButtons ? '\n' + manyToManyButtons : ''}`;

  // Generar imports adicionales para entidades asociativas
  const associativeImports = manyToManyRelations
    .map(rel => `import '${rel.associativeEntity.label.toLowerCase()}_details_screen.dart';`)
    .join('\n');

  return `import 'package:flutter/material.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../services/${endpoint}_service.dart';
import '../../models/${endpoint}_model.dart';
import '../../config/api_config.dart';
import '${endpoint}_form_screen.dart';
${associativeImports}

class ${className}ListScreen extends StatefulWidget {
  const ${className}ListScreen({Key? key}) : super(key: key);

  @override
  State<${className}ListScreen> createState() => _${className}ListScreenState();
}

class _${className}ListScreenState extends State<${className}ListScreen> {
  final ${className}Service _service = ${className}Service();
  List<${className}> _items = [];
  bool _isLoading = true;
${foreignKeys.map(fk => `  Map<int, String> _${fk.className.toLowerCase()}Map = {};`).join('\n')}

  @override
  void initState() {
    super.initState();
    _loadItems();
${foreignKeys.map(fk => `    _load${fk.className}Data();`).join('\n')}
  }

${foreignKeys
  .map(fk => {
    const relatedEndpoint = fk.className.toLowerCase() + 's';
    const displayAttr = getDisplayAttribute(fk.className, nodes);
    return `  Future<void> _load${fk.className}Data() async {
    try {
      final response = await http.get(
        Uri.parse(ApiConfig.endpoint('${relatedEndpoint}')),
        headers: ApiConfig.headers,
      ).timeout(ApiConfig.timeout);

      if (response.statusCode == 200) {
        final List<dynamic> jsonList = json.decode(response.body);
        final Map<int, String> tempMap = {};
        
        for (var item in jsonList) {
          final id = item['id'] as int;
          final displayValue = item['${displayAttr}']?.toString() ?? 'Sin nombre';
          tempMap[id] = displayValue;
        }
        
        setState(() {
          _${fk.className.toLowerCase()}Map = tempMap;
        });
      }
    } catch (e) {
      print('Error loading ${fk.className} data: \$e');
      // En caso de error, mantener el mapa vacío
      setState(() {
        _${fk.className.toLowerCase()}Map = {};
      });
    }
  }

  String _get${fk.className}Display(int id) {
    final display = _${fk.className.toLowerCase()}Map[id];
    if (display == null) {
      // Si no está en el mapa, intentar cargar los datos si aún no se han cargado
      if (_${fk.className.toLowerCase()}Map.isEmpty) {
        _load${fk.className}Data();
        return 'Cargando...';
      }
      return 'No encontrado';
    }
    return display;
  }`;
  })
  .join('\n\n')}

  Future<void> _loadItems() async {
    setState(() => _isLoading = true);
    final items = await _service.getAll();
    setState(() {
      _items = items;
      _isLoading = false;
    });
  }

  Future<void> _deleteItem(int id) async {
    final success = await _service.delete(id);
    if (success) {
      _loadItems();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Item eliminado exitosamente')),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Error al eliminar item')),
      );
    }
  }

  void _navigateToForm([${className}? item]) async {
    final result = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (context) => ${className}FormScreen(item: item),
      ),
    );
    if (result == true) {
      _loadItems();
    }
  }

${manyToManyRelations
  .map(rel => {
    const assocClassName = capitalizeFirst(rel.associativeEntity.label);
    return `  void _navigateToDetails(int ${cls.label.toLowerCase()}Id, String detailType) async {
    final result = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (context) => ${assocClassName}DetailsScreen(${cls.label.toLowerCase()}Id: ${cls.label.toLowerCase()}Id),
      ),
    );
    if (result == true) {
      _loadItems();
    }
  }`;
  })
  .join('\n\n')}

  Widget _buildItemDetails(${className} item) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ID siempre primero
        _buildDetailRow('ID', item.id.toString()),
${detailRowsCode}
      ],
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              '$label:',
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                color: Colors.deepPurple,
                fontSize: 13,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 14,
                color: Colors.black87,
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('${className}s'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () => _navigateToForm(),
            tooltip: 'Agregar ${className}',
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _items.isEmpty
              ? const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.inbox, size: 64, color: Colors.grey),
                      SizedBox(height: 16),
                      Text(
                        'No hay elementos disponibles',
                        style: TextStyle(fontSize: 16, color: Colors.grey),
                      ),
                    ],
                  ),
                )
              : ListView.builder(
                  itemCount: _items.length,
                  itemBuilder: (context, index) {
                    final item = _items[index];
                    return Card(
                      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      elevation: 4,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Header solo con botones de acción
                            Row(
                              mainAxisAlignment: MainAxisAlignment.end,
                              children: [
${actionButtons}
                              ],
                            ),
                            // Detalles de todos los atributos
                            _buildItemDetails(item),
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }

  void _showDeleteDialog(int id) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Confirmar eliminación'),
        content: const Text('¿Estás seguro de que deseas eliminar este elemento?\\n\\nEsta acción no se puede deshacer.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.red,
              foregroundColor: Colors.white,
            ),
            onPressed: () {
              Navigator.pop(context);
              _deleteItem(id);
            },
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
  }
}
`;
}

// Genera pantalla de detalles para entidades asociativas (muchos-a-muchos)
function generateDetailsScreen(
  associativeEntity: NodeType,
  mainEntity: NodeType,
  relatedEntity: NodeType,
  nodes: NodeType[]
): string {
  const assocClassName = capitalizeFirst(associativeEntity.label);
  const mainClassName = capitalizeFirst(mainEntity.label);
  const relatedClassName = capitalizeFirst(relatedEntity.label);
  const mainFieldName = mainEntity.label.toLowerCase() + 'Id';
  const relatedFieldName = relatedEntity.label.toLowerCase() + 'Id';
  const assocEndpoint = associativeEntity.label.toLowerCase() + 's';
  const relatedEndpoint = relatedEntity.label.toLowerCase() + 's';

  const ownAttributes = (associativeEntity.attributes || []).filter(
    attr => attr.name !== 'id' && attr.name !== mainFieldName && attr.name !== relatedFieldName
  );

  const relatedDisplayAttr = getDisplayAttribute(relatedEntity.label, nodes);

  // Generar filas de detalles para atributos propios de la entidad asociativa
  const detailRows = ownAttributes
    .map(attr => {
      const label = capitalizeFirst(attr.name);
      const dartType = mapDartType(attr.datatype);

      if (dartType === 'DateTime') {
        return `                            _buildDetailRow('${label}', detail.${attr.name}.toString().substring(0, 16)),`;
      } else {
        return `                            _buildDetailRow('${label}', detail.${attr.name}.toString()),`;
      }
    })
    .join('\n');

  return `import 'package:flutter/material.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../models/${associativeEntity.label.toLowerCase()}_model.dart';
import '../../config/api_config.dart';
import '${associativeEntity.label.toLowerCase()}_form_dialog.dart';

class ${assocClassName}DetailsScreen extends StatefulWidget {
  final int ${mainEntity.label.toLowerCase()}Id;
  
  const ${assocClassName}DetailsScreen({Key? key, required this.${mainEntity.label.toLowerCase()}Id}) : super(key: key);

  @override
  State<${assocClassName}DetailsScreen> createState() => _${assocClassName}DetailsScreenState();
}

class _${assocClassName}DetailsScreenState extends State<${assocClassName}DetailsScreen> {
  List<${assocClassName}> _details = [];
  Map<int, String> _${relatedEntity.label.toLowerCase()}Map = {};
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadDetails();
    _load${relatedClassName}Data();
  }

  Future<void> _loadDetails() async {
    setState(() => _isLoading = true);
    try {
      // Obtener todos los registros primero
      final response = await http.get(
        Uri.parse(ApiConfig.endpoint('${assocEndpoint}')),
        headers: ApiConfig.headers,
      ).timeout(ApiConfig.timeout);

      if (response.statusCode == 200) {
        final List<dynamic> jsonList = json.decode(response.body);
        // Filtrar por ${mainFieldName} en el cliente
        final filteredList = jsonList.where((json) => 
          json['${mainFieldName}'] == widget.${mainEntity.label.toLowerCase()}Id
        ).toList();
        
        setState(() {
          _details = filteredList.map((json) => ${assocClassName}.fromJson(json)).toList();
          _isLoading = false;
        });
      }
    } catch (e) {
      print('Error loading details: \$e');
      setState(() {
        _details = [];
        _isLoading = false;
      });
    }
  }

  Future<void> _load${relatedClassName}Data() async {
    try {
      final response = await http.get(
        Uri.parse(ApiConfig.endpoint('${relatedEndpoint}')),
        headers: ApiConfig.headers,
      ).timeout(ApiConfig.timeout);

      if (response.statusCode == 200) {
        final List<dynamic> jsonList = json.decode(response.body);
        final Map<int, String> tempMap = {};
        
        for (var item in jsonList) {
          final id = item['id'] as int;
          final displayValue = item['${relatedDisplayAttr}']?.toString() ?? 'Sin nombre';
          tempMap[id] = displayValue;
        }
        
        setState(() {
          _${relatedEntity.label.toLowerCase()}Map = tempMap;
        });
      }
    } catch (e) {
      print('Error loading ${relatedEntity.label} data: \$e');
    }
  }

  String _get${relatedClassName}Display(int? id) {
    if (id == null) return 'N/A';
    return _${relatedEntity.label.toLowerCase()}Map[id] ?? 'Cargando...';
  }



  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 80,
            child: Text(
              '$label:',
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                color: Colors.deepPurple,
                fontSize: 12,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 13,
                color: Colors.black87,
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Detalles de ${mainClassName}'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _details.isEmpty
              ? const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.inbox, size: 64, color: Colors.grey),
                      SizedBox(height: 16),
                      Text(
                        'No hay detalles disponibles',
                        style: TextStyle(fontSize: 16, color: Colors.grey),
                      ),
                    ],
                  ),
                )
              : ListView.builder(
                  itemCount: _details.length,
                  itemBuilder: (context, index) {
                    final detail = _details[index];
                    return Card(
                      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                      elevation: 2,
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${relatedClassName}: \${_get${relatedClassName}Display(detail.${relatedFieldName})}',
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 16,
                              ),
                            ),
${
  detailRows.length > 0
    ? `                            const SizedBox(height: 8),
${detailRows}`
    : ''
}
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }


}
`;
}

// Genera diálogo de formulario para entidades asociativas
function generateFormDialog(
  associativeEntity: NodeType,
  mainEntity: NodeType,
  relatedEntity: NodeType
): string {
  const assocClassName = capitalizeFirst(associativeEntity.label);
  // const mainClassName = capitalizeFirst(mainEntity.label);
  const relatedClassName = capitalizeFirst(relatedEntity.label);
  const mainFieldName = mainEntity.label.toLowerCase() + 'Id';
  const relatedFieldName = relatedEntity.label.toLowerCase() + 'Id';

  const ownAttributes = (associativeEntity.attributes || []).filter(
    attr => attr.name !== 'id' && attr.name !== mainFieldName && attr.name !== relatedFieldName
  );

  // Generar variables de estado para todos los tipos de atributos
  const allStateVars = ownAttributes
    .map(attr => {
      const dartType = mapDartType(attr.datatype);
      const fieldName = attr.name;

      if (dartType === 'DateTime') {
        return `  DateTime? _selected${capitalizeFirst(fieldName)}Date;`;
      } else if (dartType === 'bool') {
        return `  bool _${fieldName}Value = false;`;
      } else {
        // Para String, int, double usamos controladores
        return `  final _${fieldName}Controller = TextEditingController();`;
      }
    })
    .join('\n');

  // Generar campos del formulario para todos los tipos
  const formFields = ownAttributes
    .map(attr => {
      const dartType = mapDartType(attr.datatype);
      const fieldName = attr.name;
      const capitalizedName = capitalizeFirst(fieldName);

      if (dartType === 'DateTime') {
        return `                InkWell(
                  onTap: _isSaving ? null : () async {
                    final date = await showDatePicker(
                      context: context,
                      initialDate: _selected${capitalizedName}Date ?? DateTime.now(),
                      firstDate: DateTime(1900),
                      lastDate: DateTime(2100),
                    );
                    if (date != null) {
                      setState(() {
                        _selected${capitalizedName}Date = date;
                      });
                    }
                  },
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      labelText: '${capitalizedName}',
                      border: OutlineInputBorder(),
                      suffixIcon: Icon(Icons.calendar_today),
                    ),
                    child: Text(
                      _selected${capitalizedName}Date != null
                          ? '\${_selected${capitalizedName}Date!.day}/\${_selected${capitalizedName}Date!.month}/\${_selected${capitalizedName}Date!.year}'
                          : 'Seleccionar fecha',
                      style: TextStyle(
                        color: _selected${capitalizedName}Date != null ? Colors.black87 : Colors.grey,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),`;
      } else if (dartType === 'bool') {
        return `                Row(
                  children: [
                    Checkbox(
                      value: _${fieldName}Value,
                      onChanged: _isSaving ? null : (bool? value) {
                        setState(() {
                          _${fieldName}Value = value ?? false;
                        });
                      },
                    ),
                    const SizedBox(width: 8),
                    Text('${capitalizedName}'),
                  ],
                ),
                const SizedBox(height: 16),`;
      } else {
        // Para String, int, double
        const keyboardType =
          dartType === 'int'
            ? 'TextInputType.number'
            : dartType === 'double'
              ? 'TextInputType.numberWithOptions(decimal: true)'
              : 'TextInputType.text';

        return `                TextFormField(
                  controller: _${fieldName}Controller,
                  enabled: !_isSaving,
                  keyboardType: ${keyboardType},
                  decoration: const InputDecoration(
                    labelText: '${capitalizedName}',
                    border: OutlineInputBorder(),
                  ),
                  validator: (value) {
                    if (value == null || value.trim().isEmpty) {
                      return 'Este campo es requerido';
                    }
                    ${
                      dartType === 'int'
                        ? `
                    if (int.tryParse(value) == null) {
                      return 'Debe ser un número entero';
                    }`
                        : ''
                    }
                    ${
                      dartType === 'double'
                        ? `
                    if (double.tryParse(value) == null) {
                      return 'Debe ser un número válido';
                    }`
                        : ''
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 16),`;
      }
    })
    .join('\n');

  return `import 'package:flutter/material.dart';
import '../../models/${associativeEntity.label.toLowerCase()}_model.dart';

class ${assocClassName}FormDialog extends StatefulWidget {
  final int ${mainEntity.label.toLowerCase()}Id;
  final Map<int, String> ${relatedEntity.label.toLowerCase()}Options;
  final List<${assocClassName}> existingDetails; // Add this to check for duplicates
  
  const ${assocClassName}FormDialog({
    Key? key, 
    required this.${mainEntity.label.toLowerCase()}Id,
    required this.${relatedEntity.label.toLowerCase()}Options,
    required this.existingDetails,
  }) : super(key: key);

  @override
  State<${assocClassName}FormDialog> createState() => _${assocClassName}FormDialogState();
}

class _${assocClassName}FormDialogState extends State<${assocClassName}FormDialog> {
  final _formKey = GlobalKey<FormState>();
  int? _selected${relatedClassName}Id;
${allStateVars}
  bool _isSaving = false;

  @override
  void dispose() {
${ownAttributes
  .filter(attr => ['String', 'Integer', 'Float'].includes(attr.datatype))
  .map(attr => `    _${attr.name}Controller.dispose();`)
  .join('\n')}
    super.dispose();
  }

  bool _is${relatedClassName}AlreadyEnrolled(int ${relatedEntity.label.toLowerCase()}Id) {
    return widget.existingDetails.any((detail) => detail.${relatedFieldName} == ${relatedEntity.label.toLowerCase()}Id);
  }

  Future<void> _saveDetail() async {
    if (_isSaving) return;
    if (!_formKey.currentState!.validate()) return;
    
    if (_selected${relatedClassName}Id == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Debe seleccionar un ${relatedClassName}')),
      );
      return;
    }

    // Check for duplicate relationship
    if (_is${relatedClassName}AlreadyEnrolled(_selected${relatedClassName}Id!)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Este ${relatedEntity.label.toLowerCase()} ya está relacionado con este ${mainEntity.label.toLowerCase()}'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      final detail = ${assocClassName}(
        id: 0, // Always new
        ${mainFieldName}: widget.${mainEntity.label.toLowerCase()}Id,
        ${relatedFieldName}: _selected${relatedClassName}Id!,
${ownAttributes
  .map(attr => {
    const dartType = mapDartType(attr.datatype);
    const fieldName = attr.name;
    const controllerName = `_${fieldName}Controller`;

    if (dartType === 'DateTime') {
      return `        ${fieldName}: _selected${capitalizeFirst(fieldName)}Date ?? DateTime.now(),`;
    } else if (dartType === 'int') {
      return `        ${fieldName}: int.tryParse(${controllerName}.text) ?? 0,`;
    } else if (dartType === 'double') {
      return `        ${fieldName}: double.tryParse(${controllerName}.text) ?? 0.0,`;
    } else if (dartType === 'bool') {
      return `        ${fieldName}: _${fieldName}Value,`;
    } else {
      // String y otros tipos
      return `        ${fieldName}: ${controllerName}.text.trim(),`;
    }
  })
  .join('\n')}
      );

      if (mounted) {
        Navigator.pop(context, detail);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: \$e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Agregar ${assocClassName}'),
      content: SizedBox(
        width: MediaQuery.of(context).size.width * 0.8,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<int>(
                  value: _selected${relatedClassName}Id,
                  decoration: InputDecoration(
                    labelText: '${relatedClassName}',
                    border: const OutlineInputBorder(),
                    helperText: 'Solo ${relatedEntity.label.toLowerCase()}s no relacionados aparecen disponibles',
                    helperStyle: const TextStyle(fontSize: 12, color: Colors.grey),
                  ),
                  items: widget.${relatedEntity.label.toLowerCase()}Options.entries
                      .where((entry) => !_is${relatedClassName}AlreadyEnrolled(entry.key))
                      .map((entry) {
                    return DropdownMenuItem<int>(
                      value: entry.key,
                      child: Text(entry.value),
                    );
                  }).toList(),
                  onChanged: _isSaving ? null : (int? value) {
                    setState(() {
                      _selected${relatedClassName}Id = value;
                    });
                  },
                  validator: (value) {
                    if (value == null) {
                      return 'Debe seleccionar un ${relatedClassName}';
                    }
                    return null;
                  },
                ),
                // Show message if no options available
                if (widget.${relatedEntity.label.toLowerCase()}Options.entries
                    .where((entry) => !_is${relatedClassName}AlreadyEnrolled(entry.key))
                    .isEmpty)
                  Container(
                    margin: const EdgeInsets.only(top: 16),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.orange.shade50,
                      border: Border.all(color: Colors.orange.shade200),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.info, color: Colors.orange),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Todos los ${relatedEntity.label.toLowerCase()}s ya están relacionados con este ${mainEntity.label.toLowerCase()}',
                            style: TextStyle(color: Colors.orange),
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 16),
${formFields}
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.pop(context),
          child: const Text('Cancelar'),
        ),
        ElevatedButton(
          onPressed: (_isSaving || widget.${relatedEntity.label.toLowerCase()}Options.entries
              .where((entry) => !_is${relatedClassName}AlreadyEnrolled(entry.key))
              .isEmpty) ? null : _saveDetail,
          child: _isSaving 
            ? const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Text('Agregar'),
        ),
      ],
    );
  }
}
`;
}

// Genera pantalla de formulario para una clase
function generateFormScreen(cls: NodeType, nodes: NodeType[], edges: EdgeType[]): string {
  const className = capitalizeFirst(cls.label);
  const endpoint = cls.label.toLowerCase();
  const foreignKeys = getForeignKeyFields(cls, nodes, edges);
  const ownAttributes = (cls.attributes || []).filter(attr => attr.name !== 'id');
  const manyToManyRelations = getManyToManyRelations(cls, nodes, edges).filter(
    rel => rel.isMainEntity
  );

  // Generar controladores para cada campo
  const controllers = ownAttributes
    .map(attr => `  final TextEditingController _${attr.name}Controller = TextEditingController();`)
    .join('\n');

  // Generar imports adicionales para entidades asociativas
  const associativeImports = manyToManyRelations
    .map(rel => `import '${rel.associativeEntity.label.toLowerCase()}_form_dialog.dart';`)
    .join('\n');

  // Generar variables de estado para los detalles
  const detailsStateVariables = manyToManyRelations
    .map(rel => {
      const assocClassName = capitalizeFirst(rel.associativeEntity.label);
      const relatedClassName = capitalizeFirst(rel.relatedEntity.label);
      return `  List<${assocClassName}> _${rel.associativeEntity.label.toLowerCase()}Details = [];
  List<${assocClassName}> _original${assocClassName}Details = []; // Track originals
  Map<int, String> _${rel.relatedEntity.label.toLowerCase()}Options = {};
  bool _loading${relatedClassName}Options = true;`;
    })
    .join('\n');

  // Generar métodos para cargar opciones relacionadas
  const loadRelatedOptionsMethod = manyToManyRelations
    .map(rel => {
      const relatedClassName = capitalizeFirst(rel.relatedEntity.label);
      const relatedEndpoint = rel.relatedEntity.label.toLowerCase() + 's';
      const displayAttr = getDisplayAttribute(rel.relatedEntity.label, nodes);
      return `  Future<void> _load${relatedClassName}OptionsForDetails() async {
    setState(() {
      _loading${relatedClassName}Options = true;
    });
    
    try {
      final response = await http.get(
        Uri.parse(ApiConfig.endpoint('${relatedEndpoint}')),
        headers: ApiConfig.headers,
      ).timeout(ApiConfig.timeout);

      if (response.statusCode == 200) {
        final List<dynamic> jsonList = json.decode(response.body);
        final Map<int, String> tempOptions = {};
        
        for (var item in jsonList) {
          final id = item['id'] as int;
          final displayValue = item['${displayAttr}']?.toString() ?? 'Sin nombre';
          tempOptions[id] = displayValue;
        }
        
        setState(() {
          _${rel.relatedEntity.label.toLowerCase()}Options = tempOptions;
          _loading${relatedClassName}Options = false;
        });
      }
    } catch (e) {
      setState(() {
        _${rel.relatedEntity.label.toLowerCase()}Options = {};
        _loading${relatedClassName}Options = false;
      });
    }
  }`;
    })
    .join('\n\n');

  // Generar métodos para gestionar detalles
  const detailsManagementMethods = manyToManyRelations
    .map(rel => {
      const assocClassName = capitalizeFirst(rel.associativeEntity.label);
      const relatedClassName = capitalizeFirst(rel.relatedEntity.label);
      return `  void _showAdd${assocClassName}Dialog() async {
    final result = await showDialog<${assocClassName}>(
      context: context,
      builder: (context) => ${assocClassName}FormDialog(
        ${cls.label.toLowerCase()}Id: widget.item?.id ?? 0,
        ${rel.relatedEntity.label.toLowerCase()}Options: _${rel.relatedEntity.label.toLowerCase()}Options,
        existingDetails: _${rel.associativeEntity.label.toLowerCase()}Details,
      ),
    );
    if (result != null) {
      setState(() {
        _${rel.associativeEntity.label.toLowerCase()}Details.add(result);
      });
    }
  }

  void _remove${assocClassName}Detail(int index) {
    setState(() {
      _${rel.associativeEntity.label.toLowerCase()}Details.removeAt(index);
    });
  }

  String _get${relatedClassName}Display(int? id) {
    if (id == null) return 'N/A';
    return _${rel.relatedEntity.label.toLowerCase()}Options[id] ?? 'No encontrado';
  }`;
    })
    .join('\n\n');

  // Generar secciones de detalles en el formulario
  const detailsSections = manyToManyRelations
    .map(rel => {
      const assocClassName = capitalizeFirst(rel.associativeEntity.label);
      const relatedClassName = capitalizeFirst(rel.relatedEntity.label);
      const ownAttrs = (rel.associativeEntity.attributes || []).filter(
        attr =>
          attr.name !== 'id' &&
          attr.name !== cls.label.toLowerCase() + 'Id' &&
          attr.name !== rel.relatedEntity.label.toLowerCase() + 'Id'
      );

      const detailRows = ownAttrs
        .map(attr => {
          const dartType = mapDartType(attr.datatype);
          if (dartType === 'DateTime') {
            return `                                    Text('${capitalizeFirst(attr.name)}: \${detail.${attr.name}.toString().substring(0, 16)}', style: const TextStyle(fontSize: 12)),`;
          } else {
            return `                                    Text('${capitalizeFirst(attr.name)}: \${detail.${attr.name}}', style: const TextStyle(fontSize: 12)),`;
          }
        })
        .join('\n');

      return `            // Sección de ${assocClassName}s
            Card(
              margin: const EdgeInsets.symmetric(vertical: 8),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          '${assocClassName}s',
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: Colors.deepPurple,
                          ),
                        ),
                        ElevatedButton.icon(
                          onPressed: _loading${relatedClassName}Options ? null : _showAdd${assocClassName}Dialog,
                          icon: const Icon(Icons.add, size: 16),
                          label: const Text('Agregar'),
                          style: ElevatedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    _${rel.associativeEntity.label.toLowerCase()}Details.isEmpty
                        ? const Padding(
                            padding: EdgeInsets.symmetric(vertical: 20),
                            child: Center(
                              child: Text(
                                'No hay ${rel.associativeEntity.label.toLowerCase()}s agregados',
                                style: TextStyle(
                                  color: Colors.grey,
                                  fontStyle: FontStyle.italic,
                                ),
                              ),
                            ),
                          )
                        : Column(
                            children: _${rel.associativeEntity.label.toLowerCase()}Details.asMap().entries.map((entry) {
                              final index = entry.key;
                              final detail = entry.value;
                              return Card(
                                margin: const EdgeInsets.symmetric(vertical: 4),
                                elevation: 1,
                                child: ListTile(
                                  title: Text(
                                    '${relatedClassName}: \${_get${relatedClassName}Display(detail.${rel.relatedEntity.label.toLowerCase()}Id)}',
                                    style: const TextStyle(fontWeight: FontWeight.w500),
                                  ),${
                                    detailRows.length > 0
                                      ? `
                                  subtitle: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const SizedBox(height: 4),
${detailRows}
                                    ],
                                  ),`
                                      : ''
                                  }
                                  trailing: IconButton(
                                    icon: const Icon(Icons.delete, color: Colors.red, size: 20),
                                    onPressed: () => _remove${assocClassName}Detail(index),
                                    tooltip: 'Eliminar',
                                  ),
                                ),
                              );
                            }).toList(),
                          ),
                  ],
                ),
              ),
            ),`;
    })
    .join('\n');

  // Generar campos del formulario
  const formFields = [
    ...ownAttributes.map(attr => {
      const dartType = mapDartType(attr.datatype);
      if (dartType === 'DateTime') {
        return `            InkWell(
              onTap: () async {
                final date = await showDatePicker(
                  context: context,
                  initialDate: _selected${capitalizeFirst(attr.name)}Date ?? DateTime.now(),
                  firstDate: DateTime(1900),
                  lastDate: DateTime(2100),
                );
                if (date != null) {
                  setState(() {
                    _selected${capitalizeFirst(attr.name)}Date = date;
                  });
                }
              },
              child: InputDecorator(
                decoration: const InputDecoration(
                  labelText: '${capitalizeFirst(attr.name)}',
                  border: OutlineInputBorder(),
                  suffixIcon: Icon(Icons.calendar_today),
                ),
                child: Text(
                  _selected${capitalizeFirst(attr.name)}Date != null
                      ? '\${_selected${capitalizeFirst(attr.name)}Date!.day}/\${_selected${capitalizeFirst(attr.name)}Date!.month}/\${_selected${capitalizeFirst(attr.name)}Date!.year}'
                      : 'Seleccionar fecha',
                  style: TextStyle(
                    color: _selected${capitalizeFirst(attr.name)}Date != null ? Colors.black87 : Colors.grey,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),`;
      } else {
        const inputType =
          dartType === 'int' || dartType === 'double'
            ? 'TextInputType.number'
            : 'TextInputType.text';
        return `            TextFormField(
              controller: _${attr.name}Controller,
              decoration: const InputDecoration(
                labelText: '${capitalizeFirst(attr.name)}',
                border: OutlineInputBorder(),
              ),
              keyboardType: ${inputType},
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return 'Este campo es requerido';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),`;
      }
    }),
    ...foreignKeys.map(fk => {
      const label = capitalizeFirst(fk.fieldName.replace('Id', ''));
      return `            _loading${fk.className}Options
                ? const LinearProgressIndicator()
                : DropdownButtonFormField<int>(
                    value: _selected${fk.className}Id,
                    decoration: const InputDecoration(
                      labelText: '${label}',
                      border: OutlineInputBorder(),
                    ),
                    items: _${fk.className.toLowerCase()}Options.entries
                        .where((entry) => entry.key != 0) // Excluir la opción de error
                        .map((entry) {
                      return DropdownMenuItem<int>(
                        value: entry.key,
                        child: Text(entry.value),
                      );
                    }).toList(),
                    onChanged: (int? value) {
                      setState(() {
                        _selected${fk.className}Id = value;
                      });
                    },
                    validator: (value) {
                      // Campo opcional para claves foráneas
                      return null;
                    },
                    hint: _${fk.className.toLowerCase()}Options.isEmpty 
                        ? const Text('Cargando opciones...')
                        : _${fk.className.toLowerCase()}Options.containsKey(0)
                            ? Text(
                                _${fk.className.toLowerCase()}Options[0]!,
                                style: const TextStyle(color: Colors.red),
                              )
                            : const Text('Selecciona una opción'),
                  ),
            const SizedBox(height: 16),`;
    }),
  ].join('\n');

  return `import 'package:flutter/material.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../services/${endpoint}_service.dart';
import '../../models/${endpoint}_model.dart';
import '../../config/api_config.dart';
${manyToManyRelations.map(rel => `import '../../models/${rel.associativeEntity.label.toLowerCase()}_model.dart';`).join('\n')}
${associativeImports}

class ${className}FormScreen extends StatefulWidget {
  final ${className}? item;
  
  const ${className}FormScreen({Key? key, this.item}) : super(key: key);

  @override
  State<${className}FormScreen> createState() => _${className}FormScreenState();
}

class _${className}FormScreenState extends State<${className}FormScreen> {
  final ${className}Service _service = ${className}Service();
  final _formKey = GlobalKey<FormState>();
  
${controllers}
${foreignKeys.map(fk => `  int? _selected${fk.className}Id;`).join('\n')}
${foreignKeys.map(fk => `  Map<int, String> _${fk.className.toLowerCase()}Options = {};`).join('\n')}
${foreignKeys.map(fk => `  bool _loading${fk.className}Options = true;`).join('\n')}
${ownAttributes
  .filter(attr => mapDartType(attr.datatype) === 'DateTime')
  .map(attr => `  DateTime? _selected${capitalizeFirst(attr.name)}Date;`)
  .join('\n')}
${detailsStateVariables}

  @override
  void initState() {
    super.initState();
    if (widget.item != null) {
      _loadItemData();
    }
${foreignKeys.map(fk => `    _load${fk.className}Options();`).join('\n')}
${manyToManyRelations.map(rel => `    _load${capitalizeFirst(rel.relatedEntity.label)}OptionsForDetails();`).join('\n')}
  }

${foreignKeys
  .map(fk => {
    const relatedEndpoint = fk.className.toLowerCase() + 's';
    const displayAttr = getDisplayAttribute(fk.className, nodes);
    return `  Future<void> _load${fk.className}Options() async {
    setState(() {
      _loading${fk.className}Options = true;
    });
    
    try {
      final response = await http.get(
        Uri.parse(ApiConfig.endpoint('${relatedEndpoint}')),
        headers: ApiConfig.headers,
      ).timeout(ApiConfig.timeout);

      if (response.statusCode == 200) {
        final List<dynamic> jsonList = json.decode(response.body);
        final Map<int, String> tempOptions = {};
        
        for (var item in jsonList) {
          final id = item['id'] as int;
          final displayValue = item['${displayAttr}']?.toString() ?? 'Sin nombre';
          tempOptions[id] = displayValue;
        }
        
        setState(() {
          _${fk.className.toLowerCase()}Options = tempOptions;
          _loading${fk.className}Options = false;
        });
      } else {
        setState(() {
          _${fk.className.toLowerCase()}Options = {0: 'Error al cargar opciones'};
          _loading${fk.className}Options = false;
        });
      }
    } catch (e) {
      print('Error loading ${fk.className} options: \$e');
      setState(() {
        _${fk.className.toLowerCase()}Options = {0: 'Error de conexión'};
        _loading${fk.className}Options = false;
      });
    }
  }`;
  })
  .join('\n\n')}

  void _loadItemData() {
    final item = widget.item!;
${ownAttributes
  .map(attr => {
    const dartType = mapDartType(attr.datatype);
    if (dartType === 'DateTime') {
      return `    _selected${capitalizeFirst(attr.name)}Date = item.${attr.name};`;
    } else {
      return `    _${attr.name}Controller.text = item.${attr.name}.toString();`;
    }
  })
  .join('\n')}
${foreignKeys.map(fk => `    _selected${fk.className}Id = item.${fk.fieldName};`).join('\n')}
    
    // Cargar detalles existentes en modo edición
${manyToManyRelations.map(rel => `    _loadExisting${capitalizeFirst(rel.associativeEntity.label)}Details();`).join('\n')}
  }

${loadRelatedOptionsMethod}

${manyToManyRelations
  .map(rel => {
    const assocClassName = capitalizeFirst(rel.associativeEntity.label);
    const assocEndpoint = rel.associativeEntity.label.toLowerCase() + 's';
    const mainFieldName = cls.label.toLowerCase() + 'Id';
    return `  Future<void> _loadExisting${assocClassName}Details() async {
    if (widget.item == null) return;
    
    try {
      // Obtener todos los registros primero
      final response = await http.get(
        Uri.parse(ApiConfig.endpoint('${assocEndpoint}')),
        headers: ApiConfig.headers,
      ).timeout(ApiConfig.timeout);

      if (response.statusCode == 200) {
        final List<dynamic> jsonList = json.decode(response.body);
        // Filtrar por ${mainFieldName} en el cliente
        final filteredList = jsonList.where((json) => 
          json['${mainFieldName}'] == widget.item!.id
        ).toList();
        
        final existingDetails = filteredList
            .map((json) => ${assocClassName}.fromJson(json))
            .toList();
        
        setState(() {
          _${rel.associativeEntity.label.toLowerCase()}Details = List.from(existingDetails);
          _original${assocClassName}Details = List.from(existingDetails);
        });
      }
    } catch (e) {
      print('Error loading existing ${rel.associativeEntity.label.toLowerCase()} details: \$e');
    }
  }`;
  })
  .join('\n\n')}

${detailsManagementMethods}

  Future<void> _saveItem() async {
    if (!_formKey.currentState!.validate()) return;

    try {
      final item = ${className}(
        id: widget.item?.id ?? 0,
${ownAttributes
  .map(attr => {
    const dartType = mapDartType(attr.datatype);
    if (dartType === 'int') {
      return `        ${attr.name}: int.parse(_${attr.name}Controller.text),`;
    } else if (dartType === 'double') {
      return `        ${attr.name}: double.parse(_${attr.name}Controller.text),`;
    } else if (dartType === 'bool') {
      return `        ${attr.name}: _${attr.name}Controller.text.toLowerCase() == 'true',`;
    } else if (dartType === 'DateTime') {
      return `        ${attr.name}: _selected${capitalizeFirst(attr.name)}Date ?? DateTime.now(),`;
    } else {
      return `        ${attr.name}: _${attr.name}Controller.text,`;
    }
  })
  .join('\n')}
${foreignKeys.map(fk => `        ${fk.fieldName}: _selected${fk.className}Id,`).join('\n')}
      );

      ${className}? result;
      if (widget.item == null) {
        result = await _service.create(item);
      } else {
        result = await _service.update(item);
      }

      if (result != null) {
        ${
          manyToManyRelations.length > 0
            ? `// Guardar detalles (entidades asociativas)
        await _saveDetails(result.id);
        `
            : ''
        }
        Navigator.pop(context, true);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${className} \${widget.item == null ? 'creado' : 'actualizado'} exitosamente')),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Error al guardar')),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: \$e')),
      );
    }
  }

${
  manyToManyRelations.length > 0
    ? `  Future<void> _saveDetails(int ${cls.label.toLowerCase()}Id) async {
    try {
${manyToManyRelations
  .map(rel => {
    const assocClassName = capitalizeFirst(rel.associativeEntity.label);
    const assocEndpoint = rel.associativeEntity.label.toLowerCase() + 's';
    const mainFieldName = cls.label.toLowerCase() + 'Id';
    return `      // Si estamos editando, primero eliminar los detalles existentes
      if (widget.item != null) {
        for (var originalDetail in _original${assocClassName}Details) {
          try {
            await http.delete(
              Uri.parse(ApiConfig.endpoint('${assocEndpoint}/\${originalDetail.id}')),
              headers: ApiConfig.headers,
            ).timeout(ApiConfig.timeout);
          } catch (e) {
            print('Error deleting original detail \${originalDetail.id}: \$e');
          }
        }
      }

      // Guardar todos los detalles actuales
      for (var detail in _${rel.associativeEntity.label.toLowerCase()}Details) {
        try {
          final detailToSave = ${assocClassName}(
            id: 0, // Siempre crear nuevo
            ${mainFieldName}: ${cls.label.toLowerCase()}Id,
            ${rel.relatedEntity.label.toLowerCase()}Id: detail.${rel.relatedEntity.label.toLowerCase()}Id,
${(rel.associativeEntity.attributes || [])
  .filter(
    attr =>
      attr.name !== 'id' &&
      attr.name !== mainFieldName &&
      attr.name !== rel.relatedEntity.label.toLowerCase() + 'Id'
  )
  .map(attr => `            ${attr.name}: detail.${attr.name},`)
  .join('\n')}
          );
          
          await http.post(
            Uri.parse(ApiConfig.endpoint('${assocEndpoint}')),
            headers: ApiConfig.headers,
            body: json.encode(detailToSave.toJson()),
          ).timeout(ApiConfig.timeout);
        } catch (e) {
          print('Error saving ${rel.associativeEntity.label.toLowerCase()} detail: \$e');
        }
      }`;
  })
  .join('\n')}
    } catch (e) {
      print('Error in _saveDetails: \$e');
    }
  }`
    : ''
}

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('\${widget.item == null ? 'Crear' : 'Editar'} ${className}'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    children: [
${formFields}
${detailsSections}
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Cancelar'),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: _saveItem,
                      child: const Text('Guardar'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
${ownAttributes.map(attr => `    _${attr.name}Controller.dispose();`).join('\n')}
    super.dispose();
  }
}
`;
}

// Genera el drawer de navegación
function generateAppDrawer(classes: NodeType[]): string {
  const drawerItems = classes
    .map(cls => {
      const route = `/${cls.label.toLowerCase()}`;
      return `          ListTile(
            leading: const Icon(Icons.table_chart),
            title: Text('${capitalizeFirst(cls.label)}s'),
            onTap: () {
              Navigator.pop(context);
              Navigator.pushNamed(context, '${route}');
            },
          ),`;
    })
    .join('\n');

  return `import 'package:flutter/material.dart';

class AppDrawer extends StatelessWidget {
  const AppDrawer({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Drawer(
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          const DrawerHeader(
            decoration: BoxDecoration(
              color: Colors.deepPurple,
            ),
            child: Text(
              'Sistema CRUD',
              style: TextStyle(
                color: Colors.white,
                fontSize: 24,
              ),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.home),
            title: const Text('Inicio'),
            onTap: () {
              Navigator.pop(context);
              Navigator.pushReplacementNamed(context, '/');
            },
          ),
          const Divider(),
${drawerItems}
        ],
      ),
    );
  }
}
`;
}

// Función auxiliar - no se usa pero la mantenemos para compatibilidad
function generateSidebar(classes: NodeType[]): string {
  return generateAppDrawer(classes);
}

// Genera archivo de configuración centralizada de API
function generateApiConfig(): string {
  return `class ApiConfig {
  // 🔧 CONFIGURACIÓN DE LA API
  // ===============================================
  // Cambia esta URL según tu entorno:
  
  // Para emulador Android (desarrollo local):
  // static const String baseUrl = 'http://localhost:8080';
  
  // Para dispositivo físico (cambia por tu IP local):
  static const String baseUrl = 'http://192.168.0.11:8080';
  
  // Para producción:
  // static const String baseUrl = 'https://tu-api-produccion.com';
  
  // ===============================================
  
  // Headers comunes para todas las peticiones
  static const Map<String, String> headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  
  // Timeout para las peticiones (en segundos)
  static const Duration timeout = Duration(seconds: 30);
  
  // Método helper para construir URLs completas
  static String endpoint(String path) {
    return '\$baseUrl/\$path';
  }
  
  // URLs específicas si necesitas customizar alguna
  static String healthCheck() => '\$baseUrl/actuator/health';
  static String swaggerUI() => '\$baseUrl/swagger-ui/html';
}
`;
}

// Genera analysis_options.yaml
function generateAnalysisOptions(): string {
  return `include: package:flutter_lints/flutter.yaml

linter:
  rules:
    prefer_const_constructors: false
    prefer_const_literals_to_create_immutables: false
    avoid_print: false
`;
}

// Genera README.md
function generateReadme(): string {
  return `# Flutter CRUD Demo

A Flutter CRUD project generated automatically from UML diagram.

## Features

- CRUD operations for each entity
- Clean architecture with services and models
- Material Design UI
- Navigation drawer for easy access
- Form validation
- Centralized API configuration

## Getting Started

1. Ensure you have Flutter installed
2. Run \`flutter create --platforms=android .\`
3. Run \`flutter pub get\` to install dependencies
4. **Configure API URL** (see below)
5. Run \`flutter run\` to start the app

## 🔧 API Configuration

### Change API URL in ONE place:

Edit \`lib/config/api_config.dart\`:

\`\`\`dart
class ApiConfig {
  // 🔧 CHANGE THIS URL BASED ON YOUR ENVIRONMENT:
  
  // For Android emulator (local development):
  static const String baseUrl = 'http://localhost:8080';
  
  // For physical device (change to your local IP):
  // static const String baseUrl = 'http://192.168.1.100:8080';
  
  // For production:
  // static const String baseUrl = 'https://your-api.com';
}
\`\`\`

### Different Environments:

- **Emulator**: Use \`http://localhost:8080\`
- **Physical Device**: Use \`http://YOUR_COMPUTER_IP:8080\`
- **Production**: Use your production URL

### Find Your IP:
\`\`\`bash
# Linux/Mac:
ip addr show | grep inet
ifconfig | grep inet

# Windows:
ipconfig
\`\`\`

## Project Structure

\`\`\`
lib/
├── main.dart
├── config/
│   └── api_config.dart  # 🔧 API Configuration (change URL here!)
├── models/              # Data models for each entity
├── services/            # API services for each entity
├── screens/             # CRUD screens organized by entity
└── widgets/             # Shared widgets (drawer, etc.)
\`\`\`

## Backend Setup

1. Start your Spring Boot backend:
   \`\`\`bash
   cd spring-crud/
   ./mvnw spring-boot:run
   \`\`\`

2. Verify backend is running:
   - Health: \`http://localhost:8080/actuator/health\`
   - Swagger: \`http://localhost:8080/swagger-ui/html\`

## Troubleshooting

- **Connection errors**: Check \`api_config.dart\` URL
- **Emulator issues**: Use \`localhost:8080\`
- **Device issues**: Use your computer's IP address
- **CORS errors**: Add CORS configuration to Spring Boot
`;
}

export async function generarFrontend(nodes: NodeType[], edges: EdgeType[], boardName?: string) {
  console.log(`🚀 Generando Frontend Flutter${boardName ? ` para: ${boardName}` : ''}`);
  console.log(`📊 Entidades encontradas: ${nodes.length}`);
  console.log(`🔗 Relaciones encontradas: ${edges.length}`);

  const zip = new JSZip();

  // Filtrar solo clases normales (no asociativas) para navegación y pantallas principales
  const classes = nodes.filter(node => !node.asociativa);
  // Todas las clases (incluir asociativas) para modelos y servicios
  const allClasses = nodes;

  // Estructura del proyecto Flutter
  const libFolder = zip.folder('flutter-mvp/lib');
  const modelsFolder = libFolder?.folder('models');
  const servicesFolder = libFolder?.folder('services');
  const screensFolder = libFolder?.folder('screens');
  const widgetsFolder = libFolder?.folder('widgets');

  // Archivos principales
  zip.file('flutter-mvp/pubspec.yaml', generatePubspecYaml());
  zip.file('flutter-mvp/analysis_options.yaml', generateAnalysisOptions());
  zip.file('flutter-mvp/README.md', generateReadme());

  // Código fuente principal
  libFolder?.file('main.dart', generateMainDart(classes));

  // Generar modelos para cada clase (incluir asociativas)
  allClasses.forEach(cls => {
    modelsFolder?.file(
      `${cls.label.toLowerCase()}_model.dart`,
      generateModelForClass(cls, nodes, edges)
    );
  });

  // Generar servicios para cada clase (incluir asociativas)
  allClasses.forEach(cls => {
    servicesFolder?.file(`${cls.label.toLowerCase()}_service.dart`, generateServiceForClass(cls));
  });

  // Generar pantallas CRUD para cada clase
  classes.forEach(cls => {
    const screenFolder = screensFolder?.folder(cls.label.toLowerCase());
    screenFolder?.file(
      `${cls.label.toLowerCase()}_list_screen.dart`,
      generateListScreen(cls, nodes, edges)
    );
    screenFolder?.file(
      `${cls.label.toLowerCase()}_form_screen.dart`,
      generateFormScreen(cls, nodes, edges)
    );

    // Generar pantallas de detalles para relaciones muchos-a-muchos
    const manyToManyRelations = getManyToManyRelations(cls, nodes, edges).filter(
      rel => rel.isMainEntity
    );
    manyToManyRelations.forEach(relation => {
      screenFolder?.file(
        `${relation.associativeEntity.label.toLowerCase()}_details_screen.dart`,
        generateDetailsScreen(relation.associativeEntity, cls, relation.relatedEntity, nodes)
      );
      screenFolder?.file(
        `${relation.associativeEntity.label.toLowerCase()}_form_dialog.dart`,
        generateFormDialog(relation.associativeEntity, cls, relation.relatedEntity)
      );
    });
  });

  // Widgets compartidos
  widgetsFolder?.file('sidebar.dart', generateSidebar(classes));
  widgetsFolder?.file('app_drawer.dart', generateAppDrawer(classes));

  // Archivo de configuración centralizada
  const configFolder = libFolder?.folder('config');
  configFolder?.file('api_config.dart', generateApiConfig());

  // Descargar proyecto completo
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, 'flutter-mvp.zip');

  console.log(`✅ Frontend Flutter generado exitosamente${boardName ? ` para: ${boardName}` : ''}`);
  console.log(`📦 Archivo descargado: flutter-mvp.zip`);
}
