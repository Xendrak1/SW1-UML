!INC Local Scripts.EAConstants-JScript

/*
 * EXPORTAR UN PAQUETE DE EA A LA HERRAMIENTA CASE
 *
 * 1. En el Project Browser, seleccionar el paquete a exportar.
 * 2. Specialize > Tools > Scripting, nuevo script JScript, pegar esto y Run.
 * 3. El JSON queda en RUTA (por defecto C:\Temp\modelo-ea.json) y tambien
 *    impreso en la ventana de salida, por si se prefiere copiar y pegar.
 * 4. En la herramienta CASE: Intercambio > Importar > Enterprise Architect.
 */

var RUTA = "C:\\Temp\\modelo-ea.json";

function esc(s) {
  var r = "", i, ch, cod;
  s = "" + s;
  for (i = 0; i < s.length; i++) {
    ch = s.charAt(i);
    cod = s.charCodeAt(i);
    if (ch == "\"") r += "\\\"";
    else if (ch == "\\") r += "\\\\";
    else if (cod == 10) r += "\\n";
    else if (cod == 13) r += "\\r";
    else if (cod == 9) r += "\\t";
    else if (cod < 32 || cod > 126) {
      var h = cod.toString(16);
      while (h.length < 4) h = "0" + h;
      r += "\\u" + h;
    } else r += ch;
  }
  return "\"" + r + "\"";
}

function log(m) { Repository.WriteOutput("Script", m, 0); }

/** Posiciones de los elementos, tomadas del primer diagrama de clases del paquete. */
function posiciones(pkg) {
  var mapa = {}, i, j;
  for (i = 0; i < pkg.Diagrams.Count; i++) {
    var dia = pkg.Diagrams.GetAt(i);
    for (j = 0; j < dia.DiagramObjects.Count; j++) {
      var o = dia.DiagramObjects.GetAt(j);
      if (mapa["e" + o.ElementID] == null) {
        // En EA el eje Y crece hacia arriba y RectTop es negativo.
        mapa["e" + o.ElementID] = { x: o.left, y: -o.top };
      }
    }
  }
  return mapa;
}

function main() {
  Repository.EnsureOutputVisible("Script");
  var pkg = Repository.GetTreeSelectedPackage();
  if (pkg == null) { log("ERROR: selecciona un paquete en el Project Browser."); return; }
  log("Exportando el paquete: " + pkg.Name);

  var pos = posiciones(pkg);
  var clases = [], conectores = [], i, j, k;
  var idsDelPaquete = {};

  for (i = 0; i < pkg.Elements.Count; i++) {
    var el = pkg.Elements.GetAt(i);
    if (el.Type != "Class") continue;
    idsDelPaquete["e" + el.ElementID] = true;
  }

  for (i = 0; i < pkg.Elements.Count; i++) {
    var el = pkg.Elements.GetAt(i);
    if (el.Type != "Class") continue;

    var p = pos["e" + el.ElementID];
    var x = p == null ? 40 + (clases.length % 4) * 300 : p.x;
    var y = p == null ? 40 + Math.floor(clases.length / 4) * 240 : p.y;

    var atts = [];
    for (j = 0; j < el.Attributes.Count; j++) {
      var a = el.Attributes.GetAt(j);
      atts.push("{\"nombre\":" + esc(a.Name) + ",\"tipo\":" + esc(a.Type) +
                ",\"visibilidad\":" + esc(a.Visibility) + "}");
    }

    clases.push("{\"id\":" + esc("" + el.ElementID) + ",\"guid\":" + esc(el.ElementGUID) +
                ",\"nombre\":" + esc(el.Name) +
                ",\"estereotipo\":" + esc(el.Stereotype) +
                ",\"x\":" + x + ",\"y\":" + y +
                ",\"atributos\":[" + atts.join(",") + "]}");

    for (k = 0; k < el.Connectors.Count; k++) {
      var c = el.Connectors.GetAt(k);
      // Cada conector aparece en los dos extremos: se toma una sola vez,
      // desde el lado del Client.
      if (c.ClientID != el.ElementID) continue;
      if (idsDelPaquete["e" + c.SupplierID] == null) continue;
      conectores.push("{\"guid\":" + esc(c.ConnectorGUID) + ",\"tipo\":" + esc(c.Type) +
        ",\"origen\":" + esc("" + c.ClientID) + ",\"destino\":" + esc("" + c.SupplierID) +
        ",\"cardOrigen\":" + esc(c.ClientEnd.Cardinality) +
        ",\"cardDestino\":" + esc(c.SupplierEnd.Cardinality) +
        ",\"aggOrigen\":" + c.ClientEnd.Aggregation +
        ",\"aggDestino\":" + c.SupplierEnd.Aggregation + "}");
    }
  }

  var json = "{\"herramienta\":\"Enterprise Architect\",\"paquete\":" + esc(pkg.Name) +
             ",\"clases\":[" + clases.join(",") + "]" +
             ",\"conectores\":[" + conectores.join(",") + "]}";

  try {
    var fso = new ActiveXObject("Scripting.FileSystemObject");
    var carpeta = RUTA.substring(0, RUTA.lastIndexOf("\\"));
    if (!fso.FolderExists(carpeta)) fso.CreateFolder(carpeta);
    var f = fso.CreateTextFile(RUTA, true);
    f.Write(json);
    f.Close();
    log("Archivo escrito: " + RUTA);
  } catch (err) {
    log("No se pudo escribir el archivo (" + err.message + "). Copia el JSON de abajo.");
  }

  log("Clases: " + clases.length + " | Relaciones: " + conectores.length);
  log(json);
}

main();
