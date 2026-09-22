/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useRef, useEffect, useCallback } from 'react';

import EdgeLayer from '../components/EdgeLayer';
import ModeBanner from '../components/ModeBanner';
import Toolbar from '../components/Toolbar';
import ZoomDock from '../components/ZoomDock';
import Node from '../components/Node';
import { useBoards } from '../hooks/useDiagramSync';
import { importDiagramFromImage } from '../services/diagramImportService';
import { useClassStore } from '../store/classStore';
import { generarBackend } from '../utils/backendGenerator';
import { ADAPTADORES, SCRIPT_EXPORTAR_DESDE_EA, buscarAdaptador } from '../utils/architech';
import { SelectorDiagramaEa } from '../components/SelectorDiagramaEa';
import {
  aModelo,
  esArchivoEa,
  leerProyectoEa,
  type DiagramaDisponible,
} from '../services/eaImportService';
import AjustesIaPanel from '../components/AjustesIaPanel';
import { api } from '../lib/apiClient';
import { flowEdgesToUml, flowNodesToUml } from '../lib/flowToUml';
import { generarFrontend } from '../utils/frontendGenerator';
import type { NodeChange, EdgeChange } from 'reactflow';
import type { NodeType, EdgeType } from '../utils/umlConstants';
import { NODE_WIDTH, NODE_HEIGHT, calculateNodeHeight } from '../utils/umlConstants';
//estos son parte del asistente uml
import UmlPrompt from './UmlPrompt';
import './StylesUmlPrompt.css';

// Tipos para datos de Supabase
type SupabaseNodeData = {
  label?: string;
  attributes?: Array<{
    name: string;
    scope: 'public' | 'private' | 'protected';
    type: string;
  }>;
  x?: number;
  y?: number;
  asociativa?: boolean;
  relaciona?: [string, string];
};

type SupabaseNode = {
  id: string;
  data?: SupabaseNodeData;
  position?: { x: number; y: number };
};

type ReactFlowEdge = {
  id: string;
  source: string;
  target: string;
  data?: {
    edgeType?: string;
    sourceMultiplicity?: string;
    targetMultiplicity?: string;
  };
};

type SupabaseEdgeOutput = {
  id: string;
  source: string;
  target: string;
  data: {
    edgeType: string;
    sourceMultiplicity: '1' | '*';
    targetMultiplicity: '1' | '*';
  };
  type?: string;
};

const BoardPage = () => {
  // Estado para el asistente UML
  const [isPromptOpen, setIsPromptOpen] = useState(false);

  // Boards colaborativos desde Supabase
  const { boards, isLoading: boardsLoading, createBoard, deleteBoard, renameBoard } = useBoards();
  // La pizarra activa se recuerda entre recargas; si no hay ninguna guardada se
  // toma la primera que devuelva el servidor. Antes habia un id fijo en el codigo,
  // que dejaba de existir al cambiar de base de datos.
  const [ajustesIaAbiertos, setAjustesIaAbiertos] = useState(false);
  const [currentBoardId, setCurrentBoardId] = useState<string>(
    () => localStorage.getItem('case.boardId') ?? ''
  );
  const [showBoardMenu, setShowBoardMenu] = useState<boolean>(false);
  
  const currentBoard = boards.find(b => b.id === currentBoardId) ?? boards[0];
  const currentDiagramId = currentBoard?.diagram_id ?? null;

  // Cuando llega la lista de pizarras, fijamos la activa (la recordada o la primera).
  useEffect(() => {
    if (boards.length === 0) return;
    const valida = boards.some(b => b.id === currentBoardId);
    if (!valida) setCurrentBoardId(boards[0].id);
  }, [boards, currentBoardId]);

  useEffect(() => {
    if (currentBoardId) localStorage.setItem('case.boardId', currentBoardId);
  }, [currentBoardId]);

  // Un usuario nuevo no tiene pizarras, y sin una abierta el editor no tiene
  // donde guardar (las operaciones se descartan) ni sala WebSocket a la que
  // conectarse: la barra queda en "Sin conexion" para siempre aunque la red y
  // la sesion esten bien. Se le crea la primera pizarra apenas entra.
  const [creandoPrimera, setCreandoPrimera] = useState(false);
  useEffect(() => {
    if (boardsLoading || boards.length > 0 || creandoPrimera) return;
    setCreandoPrimera(true);
    void createBoard('Pizarra 1')
      .then(id => setCurrentBoardId(id))
      .catch(err => {
        // Sin servidor no hay pizarra nueva: se queda en el modo offline con
        // lo que haya en cache, en vez de reintentar en cada render.
        console.warn('[boards] no se pudo crear la primera pizarra', err);
        setCreandoPrimera(false);
      });
  }, [boardsLoading, boards.length, creandoPrimera, createBoard]);

  // Referencia para evitar bucles infinitos
  const lastDiagramIdRef = useRef<string | null>(null);

  // Store con sincronización en tiempo real
  const {
    nodes: storeNodes,
    edges: storeEdges,
    isLoading,
    updateNode,
    saveDiagram,
    addClass,
    onNodesChange,
    onEdgesChange,
    setCurrentDiagram,
    loadDiagram,
    cleanupRealtimeSync,
  } = useClassStore();

  // Sincronizar el store con el diagrama actual
  useEffect(() => {
    if (!currentDiagramId) return;
    if (lastDiagramIdRef.current !== currentDiagramId) {
      lastDiagramIdRef.current = currentDiagramId;
      setCurrentDiagram(currentDiagramId);
      loadDiagram(currentDiagramId);
    }
  }, [currentDiagramId, setCurrentDiagram, loadDiagram]);

  // Limpiar sincronización colaborativa al desmontar
  useEffect(() => {
    return () => {
      cleanupRealtimeSync();
    };
  }, [cleanupRealtimeSync]);

  // Estados de UI
  const [zoom, setZoom] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Estados de interacción
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [relationMode, setRelationMode] = useState<{
    sourceId: string | null;
    type: string | null;
    sourceMultiplicity?: '1' | '*';
    targetMultiplicity?: '1' | '*';
  } | null>(null);
  const [manyToManyMode, setManyToManyMode] = useState<{ sourceId: string | null } | null>(null);
  const [currentMode, setCurrentMode] = useState<'normal' | 'relation' | 'manyToMany'>('normal');
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);

  // Estados para importación de imágenes
  const [importing, setImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const eaInputRef = useRef<HTMLInputElement>(null);

  // Importacion de un proyecto de Enterprise Architect.
  const [ea, setEa] = useState<{ archivo: string; diagramas: DiagramaDisponible[] } | null>(null);
  const [arrastrando, setArrastrando] = useState(false);

  // Estados para intercambio con otras herramientas CASE
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [formatoCase, setFormatoCase] = useState<string>('json');

  // Sistema de debounce para guardado automático
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(async () => {
      await saveDiagram();
    }, 2000);
  }, [saveDiagram]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Funciones de conversión entre tipos Supabase y UML
  const convertSupabaseToUMLNodes = (supabaseNodes: SupabaseNode[]): NodeType[] => {
    return supabaseNodes.map(node => {
      const attributes =
        node.data?.attributes?.map(attr => ({
          name: attr.name,
          scope: attr.scope,
          datatype: (attr.type as 'Integer' | 'Float' | 'String' | 'Boolean' | 'Date') || 'String',
        })) || [];

      const nodeType: NodeType = {
        id: node.id,
        label: node.data?.label || 'Class',
        x: node.position?.x || 0,
        y: node.position?.y || 0,
        attributes: attributes,
        asociativa: node.data?.asociativa || false,
        relaciona: node.data?.relaciona || undefined,
      };

      return {
        ...nodeType,
        height: calculateNodeHeight(nodeType),
      };
    });
  };

  const convertUMLToSupabaseNode = (node: NodeType) => ({
    id: node.id,
    type: 'default',
    position: { x: node.x, y: node.y },
    data: {
      label: node.label,
      attributes:
        node.attributes?.map(attr => ({
          id: `attr-${Date.now()}`,
          name: attr.name,
          type: attr.datatype,
          scope: attr.scope,
        })) || [],
      asociativa: node.asociativa,
      relaciona: node.relaciona,
    },
  });

  const convertReactFlowToUMLEdge = (edge: ReactFlowEdge): EdgeType => {
    const validEdgeTypes = [
      'asociacion',
      'agregacion',
      'composicion',
      'herencia',
      'dependencia',
    ] as const;
    const edgeType = edge.data?.edgeType || 'asociacion';
    const tipo = (validEdgeTypes as readonly string[]).includes(edgeType)
      ? (edgeType as EdgeType['tipo'])
      : 'asociacion';

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      tipo,
      multiplicidadOrigen: normalizeMultiplicity(edge.data?.sourceMultiplicity),
      multiplicidadDestino: normalizeMultiplicity(edge.data?.targetMultiplicity),
    };
  };

  const convertUMLToSupabaseEdge = (umlEdge: EdgeType): SupabaseEdgeOutput => {
    return {
      id: umlEdge.id,
      source: umlEdge.source,
      target: umlEdge.target,
      data: {
        edgeType: umlEdge.tipo,
        sourceMultiplicity: normalizeMultiplicity(umlEdge.multiplicidadOrigen),
        targetMultiplicity: normalizeMultiplicity(umlEdge.multiplicidadDestino),
      },
      type: 'umlEdge',
    };
  };

  const normalizeMultiplicity = (multiplicity: string | undefined): '1' | '*' => {
    if (!multiplicity) return '1';
    if (multiplicity.includes('..') || multiplicity === '*') return '*';
    return '1';
  };

  // Convertir nodos y edges del store
  const nodes = storeNodes ? convertSupabaseToUMLNodes(storeNodes as any) : [];
  const edges = storeEdges || [];

  const currentBoardData = boards.find(b => b.id === currentBoardId);

  const updateNodePosition = (nodeId: string, x: number, y: number) => {
    const nodeChanges: NodeChange[] = [
      {
        id: nodeId,
        type: 'position',
        position: { x, y },
      },
    ];
    onNodesChange(nodeChanges);
  };

  const finishNodeDrag = () => {
    debouncedSave();
  };

  const removeNodeAndEdges = async (nodeId: string) => {
    const nodeChanges: NodeChange[] = [{ id: nodeId, type: 'remove' }];
    onNodesChange(nodeChanges);

    const edgesToRemove = storeEdges?.filter(e => e.source === nodeId || e.target === nodeId) || [];
    const edgeChanges: EdgeChange[] = edgesToRemove.map(edge => ({ id: edge.id, type: 'remove' }));
    onEdgesChange(edgeChanges);

    await saveDiagram();
  };

  // Mostrar estado de carga - SOLO una vez, no en bucle
  if (isLoading && !storeNodes) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <h3>Cargando diagrama desde Supabase...</h3>
        <div>Diagrama ID: {currentDiagramId}</div>
      </div>
    );
  }

  // Funciones para manejo de pizarras múltiples

  const switchToBoard = (boardId: string) => {
    if (boardId === currentBoardId) return;
    setCurrentBoardId(boardId);
    setShowBoardMenu(false);
  };

  const createNewBoard = async () => {
    try {
      const boardId = await createBoard(`Nueva Pizarra ${boards.length + 1}`);
      setCurrentBoardId(boardId);
      setShowBoardMenu(false);
    } catch {
      alert('Error creando pizarra');
    }
  };

  const deleteBoardConfirm = async (boardId: string) => {
    if (boards.length <= 1) {
      alert('No puedes eliminar la última pizarra');
      return;
    }

    if (window.confirm('¿Estás seguro de que quieres eliminar esta pizarra?')) {
      try {
        await deleteBoard(boardId);
        if (currentBoardId === boardId && boards.length > 1) {
          setCurrentBoardId(boards[0].id);
        }
      } catch {
        alert('Error eliminando pizarra');
      }
    }
    setShowBoardMenu(false);
  };

  const renameBoardPrompt = async (boardId: string) => {
    const board = boards.find(b => b.id === boardId);
    if (board) {
      const newName = window.prompt('Nuevo nombre para la pizarra:', board.name);
      if (newName && newName.trim()) {
        try {
          await renameBoard(boardId, newName.trim());
        } catch {
          alert('Error renombrando pizarra');
        }
      }
    }
    setShowBoardMenu(false);
  };

  const deleteEdge = async (edgeId: string) => {
    const edgeChanges: EdgeChange[] = [{ id: edgeId, type: 'remove' }];
    onEdgesChange(edgeChanges);
    await saveDiagram();
  };

  // Movimiento de nodos y panning
  const handleMouseDown = (e: React.MouseEvent, node: NodeType) => {
    e.stopPropagation();
    setDraggingId(node.id);
    setDragOffset({
      x: e.clientX / zoom - panOffset.x - node.x,
      y: e.clientY / zoom - panOffset.y - node.y,
    });
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Solo iniciar panning si no estamos arrastrando un nodo
    if (!draggingId && e.button === 0) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };

  const handleMouseUp = () => {
    // 🔧 Si estábamos dragging, guardar la posición final
    if (draggingId) {
      finishNodeDrag();
    }
    
    setDraggingId(null);
    setDragOffset(null);
    setIsPanning(false);
    setPanStart(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingId && dragOffset) {
      //  Mover nodo solo localmente (sin await ni guardado inmediato)
      const newX = e.clientX / zoom - panOffset.x - dragOffset.x;
      const newY = e.clientY / zoom - panOffset.y - dragOffset.y;
      updateNodePosition(draggingId, newX, newY);
    } else if (isPanning && panStart) {
      // Hacer panning del canvas
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    }
  };

  const addAttribute = async (id: string) => {
    const currentNode = storeNodes?.find(n => n.id === id);
    if (currentNode) {
      const currentAttrs = currentNode.data?.attributes || [];
      const newAttr = {
        id: `attr-${Date.now()}`,
        name: `Atributo${currentAttrs.length + 1}`,
        type: 'String' as 'Integer' | 'Float' | 'String' | 'Boolean' | 'Date',
        scope: 'private' as 'public' | 'private' | 'protected',
      };

      const newAttrs = [...currentAttrs, newAttr];
      await updateNode(id, { attributes: newAttrs });
      updateNode(id, { attributes: newAttrs } as any);
      debouncedSave();
    }
  };

  const deleteAttribute = async (nodeId: string, attrIdx: number) => {
    const currentNode = storeNodes?.find(n => n.id === nodeId);
    if (currentNode) {
      const newAttrs =
        currentNode.data?.attributes?.filter((_attr, idx: number) => idx !== attrIdx) || [];
      await updateNode(nodeId, { attributes: newAttrs });
      updateNode(nodeId, { attributes: newAttrs } as any);
      debouncedSave();
    }
  };

  const editNodeLabel = async (id: string, newLabel: string) => {
    await updateNode(id, { label: newLabel });
    debouncedSave();
  };

  const editAttribute = async (
    nodeId: string,
    attrIdx: number,
    field: 'name' | 'scope' | 'datatype',
    newValue: string
  ) => {
    const currentNode = storeNodes?.find(n => n.id === nodeId);
    if (currentNode) {
      const updatedAttrs =
        currentNode.data?.attributes?.map((attr: any, idx: number) =>
          idx === attrIdx ? { ...attr, [field === 'datatype' ? 'type' : field]: newValue } : attr
        ) || [];

      await updateNode(nodeId, { attributes: updatedAttrs });
      debouncedSave();
    }
  };

  const handleStartRelation = (id: string, type: string) => {
    // 🎯 Procesar multiplicidad si viene en el formato "tipo:origen:destino"
    let relationType = type;
    let sourceMultiplicity: '1' | '*' = '1';
    let targetMultiplicity: '1' | '*' = '1';

    if (type.includes(':')) {
      const parts = type.split(':');
      relationType = parts[0];
      sourceMultiplicity = parts[1] as '1' | '*';
      targetMultiplicity = parts[2] as '1' | '*';
    }

    setRelationMode({
      sourceId: id,
      type: relationType,
      sourceMultiplicity,
      targetMultiplicity,
    });
    setCurrentMode('relation');
  };
  const handleSelectAsTarget = async (id: string) => {
    if (relationMode && relationMode.sourceId && relationMode.sourceId !== id) {
      // 🎯 Usar multiplicidades del relationMode si están disponibles, sino valores por defecto
      let multiplicidadOrigen: '1' | '*' = relationMode.sourceMultiplicity || '1';
      let multiplicidadDestino: '1' | '*' = relationMode.targetMultiplicity || '1';

      // Asignar multiplicidades por defecto según el tipo de relación (solo si no fueron especificadas)
      if (!relationMode.sourceMultiplicity && !relationMode.targetMultiplicity) {
        if (relationMode.type === 'herencia') {
          multiplicidadOrigen = '1';
          multiplicidadDestino = '1';
        } else if (relationMode.type === 'composicion' || relationMode.type === 'agregacion') {
          multiplicidadOrigen = '1';
          multiplicidadDestino = '*';
        } else if (relationMode.type === 'dependencia') {
          multiplicidadOrigen = '1';
          multiplicidadDestino = '1';
        }
      }

      const umlEdge: EdgeType = {
        id: `e${Date.now()}`,
        source: relationMode.sourceId,
        target: id,
        tipo: (relationMode.type || 'asociacion') as EdgeType['tipo'],
        multiplicidadOrigen,
        multiplicidadDestino,
      };

      const supabaseEdge = convertUMLToSupabaseEdge(umlEdge);
      const edgeChanges = [{ id: supabaseEdge.id, type: 'add', item: supabaseEdge }];
      onEdgesChange(edgeChanges as any);
      await saveDiagram();

      // Limpiar estado
      setRelationMode(null);
      setCurrentMode('normal');
    }
  };

  // Muchos a muchos
  const handleStartManyToMany = () => {
    setManyToManyMode({ sourceId: null });
    setCurrentMode('manyToMany');
  };
  const handleSelectManyToManySource = (id: string) => setManyToManyMode({ sourceId: id });
  const handleSelectManyToManyTarget = async (id: string) => {
    if (manyToManyMode?.sourceId && manyToManyMode.sourceId !== id) {
      const sourceNode = nodes.find(n => n.id === manyToManyMode.sourceId);
      const targetNode = nodes.find(n => n.id === id);
      const newTableLabel =
        window.prompt(
          'Nombre de la tabla intermedia:',
          `${sourceNode?.label}_${targetNode?.label}`
        ) || `Intermedia_${Date.now()}`;

      const newTableId = `T${Date.now()}`;

      // Crear nodo UML y convertir a Supabase
      const umlNode: NodeType = {
        id: newTableId,
        x: 200,
        y: 200,
        label: newTableLabel,
        attributes: [],
        asociativa: true,
        relaciona: [manyToManyMode.sourceId, id],
      };

      const supabaseNode = convertUMLToSupabaseNode(umlNode);
      const nodeChanges = [{ id: newTableId, type: 'add', item: supabaseNode }];
      onNodesChange(nodeChanges as any);

      // Crear edges UML y convertir a Supabase
      const umlEdge1: EdgeType = {
        id: `e${Date.now()}_1`,
        source: manyToManyMode.sourceId,
        target: newTableId,
        tipo: 'asociacion',
        multiplicidadOrigen: '1',
        multiplicidadDestino: '*',
      };

      const umlEdge2: EdgeType = {
        id: `e${Date.now()}_2`,
        source: id,
        target: newTableId,
        tipo: 'asociacion',
        multiplicidadOrigen: '1',
        multiplicidadDestino: '*',
      };

      const supabaseEdge1 = convertUMLToSupabaseEdge(umlEdge1);
      const supabaseEdge2 = convertUMLToSupabaseEdge(umlEdge2);

      const edgeChanges = [
        { id: supabaseEdge1.id, type: 'add', item: supabaseEdge1 },
        { id: supabaseEdge2.id, type: 'add', item: supabaseEdge2 },
      ];
      onEdgesChange(edgeChanges as any);

      await saveDiagram();
      setManyToManyMode(null);
      setCurrentMode('normal');
    }
  };

  const cancelCurrentMode = () => {
    setRelationMode(null);
    setManyToManyMode(null);
    setCurrentMode('normal');
  };

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.1, 2));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.1, 0.5));
  const handleResetZoom = () => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleFitAll = () => {
    if (nodes.length === 0) return;

    const margin = 50;
    const minX = Math.min(...nodes.map(n => n.x)) - margin;
    const maxX = Math.max(...nodes.map(n => n.x + NODE_WIDTH)) + margin;
    const minY = Math.min(...nodes.map(n => n.y)) - margin;
    const maxY = Math.max(...nodes.map(n => n.y + (n.height || NODE_HEIGHT))) + margin;

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight - 70;

    const scaleX = viewWidth / contentWidth;
    const scaleY = viewHeight / contentHeight;
    const newZoom = Math.min(scaleX, scaleY, 1.5);

    setZoom(newZoom);
    setPanOffset({
      x: (viewWidth - contentWidth * newZoom) / 2 - minX * newZoom,
      y: (viewHeight - contentHeight * newZoom) / 2 - minY * newZoom,
    });
  };

  const addNode = async () => {
    addClass();
    await saveDiagram();
  };

  const handleGenerarBackend = () => {
    generarBackend(
      nodes,
      edges.map(convertReactFlowToUMLEdge),
      currentBoardData?.name || 'Diagrama Principal'
    );
  };

  const handleGenerarFrontend = () => {
    generarFrontend(
      nodes,
      edges.map(convertReactFlowToUMLEdge),
      currentBoardData?.name || 'Diagrama Principal'
    );
  };

  const handleImportImage = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    // Validaciones
    if (!file.type.startsWith('image/')) {
      alert('❌ Solo se permiten archivos de imagen');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert('❌ El archivo debe ser menor a 5MB');
      return;
    }

    setImporting(true);
    console.log(`📤 Iniciando importación de: ${file.name}`);

    try {
      const result = await importDiagramFromImage(file, stage => setImportProgress(stage));

      if (result.success && result.nodes && result.edges) {
        // Los nodos e edges ya vienen con IDs únicos del servicio
        // Solo necesitamos agregar prefijo para evitar conflictos con nodos existentes
        const importTimestamp = Date.now();

        const importedNodes = result.nodes.map(node => ({
          ...node,
          id: `imported_${importTimestamp}_${node.id}`,
          // Actualizar relaciona para entidades asociativas
          relaciona: node.relaciona
            ? node.relaciona.map(relId => `imported_${importTimestamp}_${relId}`)
            : undefined,
        }));

        const importedEdges = result.edges.map(edge => ({
          ...edge,
          id: `imported_${importTimestamp}_${edge.id}`,
          source: `imported_${importTimestamp}_${edge.source}`,
          target: `imported_${importTimestamp}_${edge.target}`,
        }));

        // ✅ Convertir nodos importados a formato Supabase
        const supabaseNodes = importedNodes.map(node =>
          convertUMLToSupabaseNode({
            id: node.id,
            x: node.x,
            y: node.y,
            label: node.label,
            attributes:
              node.attributes?.map(attr => ({
                name: attr.name,
                datatype: attr.datatype,
                scope: attr.scope,
              })) || [],
            asociativa: node.asociativa,
            relaciona:
              node.relaciona && node.relaciona.length >= 2
                ? ([node.relaciona[0], node.relaciona[1]] as [string, string])
                : undefined,
          })
        );

        const supabaseEdges = importedEdges.map(edge =>
          convertUMLToSupabaseEdge({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            tipo: (edge.tipo || 'asociacion') as
              | 'asociacion'
              | 'agregacion'
              | 'composicion'
              | 'herencia'
              | 'dependencia',
            multiplicidadOrigen: edge.multiplicidadOrigen || '1',
            multiplicidadDestino: edge.multiplicidadDestino || '*',
          })
        );

        // Agregar a Supabase usando los cambios
        const nodeChanges = supabaseNodes.map(node => ({ id: node.id, type: 'add', item: node }));
        const edgeChanges = supabaseEdges.map(edge => ({ id: edge.id, type: 'add', item: edge }));

        onNodesChange(nodeChanges as any);
        onEdgesChange(edgeChanges as any);

        await saveDiagram();

        console.log(
          `✅ Importación exitosa: ${importedNodes.length} clases, ${importedEdges.length} relaciones`
        );
        alert(
          `✅ Diagrama importado exitosamente!\n${importedNodes.length} clases y ${importedEdges.length} relaciones agregadas`
        );

        // Ajustar vista para mostrar todo el contenido
        setTimeout(() => handleFitAll(), 100);
      } else {
        console.error('❌ Error en importación:', result.error);
        alert(`❌ Error importando diagrama: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Error inesperado:', error);
      alert(`❌ Error inesperado: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    } finally {
      setImporting(false);
      setImportProgress('');
      // Limpiar input file
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Funciones para importar JSON
  const handleImportJSON = () => {
    jsonInputRef.current?.click();
  };

  /** El mismo selector, pero apuntado a los proyectos de Enterprise Architect. */
  const handleImportEa = () => {
    eaInputRef.current?.click();
  };

  /**
   * Volca un modelo importado en la pizarra. Lo usan los tres caminos de
   * importacion -archivo, arrastrar y soltar, y proyecto de EA-, para que no
   * haya tres copias de este pegado.
   */
  const aplicarModeloImportado = async (
    newNodes: NodeType[],
    newEdges: EdgeType[],
    origen: string
  ) => {
    const supabaseNodes = newNodes.map(convertUMLToSupabaseNode);
    const supabaseEdges = newEdges.map(convertUMLToSupabaseEdge);

    const nodeChanges = supabaseNodes.map((node: any) => ({ id: node.id, type: 'add', item: node }));
    const edgeChanges = supabaseEdges.map((edge: any) => ({ id: edge.id, type: 'add', item: edge }));

    onNodesChange(nodeChanges as any);
    onEdgesChange(edgeChanges as any);
    await saveDiagram();
    console.log(`Diagrama importado desde ${origen}: ${newNodes.length} clases`);
  };

  /**
   * Abre un proyecto de Enterprise Architect (.eapx / .eap).
   *
   * El archivo va al servidor, que es el que puede leerlo -por dentro es una
   * base de datos Access-, y vuelve con los diagramas de clases que contiene.
   * Si trae uno solo se importa derecho; si trae varios se pregunta cual.
   */
  const abrirProyectoEa = async (file: File) => {
    setImporting(true);
    setImportProgress('Leyendo el proyecto de Enterprise Architect...');
    try {
      const diagramas = await leerProyectoEa(file);
      if (diagramas.length === 1) {
        const modelo = aModelo(diagramas[0]);
        await aplicarModeloImportado(modelo.nodes, modelo.edges, `EA · ${diagramas[0].nombre}`);
      } else {
        setEa({ archivo: file.name, diagramas });
      }
    } catch (error) {
      console.error('Error importando el proyecto de EA:', error);
      alert(
        `No se pudo importar el proyecto de Enterprise Architect:\n\n${
          error instanceof Error ? error.message : 'Error desconocido'
        }`
      );
    } finally {
      setImporting(false);
      setImportProgress('');
    }
  };

  const elegirDiagramaEa = async (d: DiagramaDisponible) => {
    setEa(null);
    try {
      const modelo = aModelo(d);
      await aplicarModeloImportado(modelo.nodes, modelo.edges, `EA · ${d.nombre}`);
    } catch (error) {
      alert(
        `No se pudo importar "${d.nombre}":\n\n${
          error instanceof Error ? error.message : 'Error desconocido'
        }`
      );
    }
  };

  /** Importa cualquier archivo soportado, venga del selector o de arrastrarlo. */
  const importarArchivo = async (file: File) => {
    if (esArchivoEa(file.name)) {
      await abrirProyectoEa(file);
      return;
    }

    // El formato se deduce de la extension, no del selector: asi se puede arrastrar
    // un archivo de otra herramienta sin haber elegido antes su formato.
    const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    const adaptador =
      ADAPTADORES.find(a => a.extension === extension && a.disponible) ?? buscarAdaptador('json');

    try {
      if (!adaptador) throw new Error(`No hay un adaptador para los archivos ${extension}`);
      const text = await file.text();
      const { nodes: newNodes, edges: newEdges } = adaptador.importar(text);
      await aplicarModeloImportado(newNodes, newEdges, adaptador.nombre);
    } catch (error) {
      console.error('Error importando el diagrama:', error);
      alert(
        `Error al importar el archivo: ${error instanceof Error ? error.message : 'Error desconocido'}`
      );
    }
  };

  const handleJSONFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) await importarArchivo(files[0]);
    e.target.value = '';
  };

  const handleExportJSON = () => {
    try {
      const adaptador = buscarAdaptador(formatoCase);
      if (!adaptador) throw new Error('Formato de exportacion no reconocido');

      // Se exporta el modelo UML, no el estado interno del editor: eso es lo que
      // entienden las otras herramientas CASE.
      const contenido = adaptador.exportar({
        nodes: flowNodesToUml(storeNodes ?? []),
        edges: flowEdgesToUml(storeEdges ?? []),
      });

      const blob = new Blob([contenido], { type: `${adaptador.mimeType};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentBoardData?.name || 'diagrama'}${adaptador.extension}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exportando el diagrama:', error);
      alert(`Error al exportar: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    }
  };

  /**
   * Descarga el script que se corre EN Enterprise Architect para traer un
   * modelo hacia aca. Es la mitad "EA -> CASE" del intercambio: sin el, el
   * ida y vuelta quedaria en una sola direccion.
   */
  const handleScriptExportarEa = () => {
    const blob = new Blob([SCRIPT_EXPORTAR_DESDE_EA], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ExportarDesdeEA.js';
    a.click();
    URL.revokeObjectURL(url);
    alert(
      'Se descargo ExportarDesdeEA.js.\n\n' +
        'En Enterprise Architect 15:\n' +
        '1. Selecciona el paquete a exportar en el Project Browser.\n' +
        '2. Specialize > Tools > Scripting, nuevo script JScript.\n' +
        '3. Pega el contenido del archivo y dale Run.\n' +
        '4. Volve aca e importa el JSON que deja en C:\\Temp\\modelo-ea.json.'
    );
  };

  /**
   * Genera un enlace de invitacion a ESTA pizarra y lo copia.
   *
   * Antes copiaba la URL de la pagina, que a quien la recibia no le servia de
   * nada: sin cuenta no se entra, y crear una cuenta pedia un codigo que solo
   * tenia quien administra el servidor. El enlace de invitacion resuelve las dos
   * cosas de una vez: quien lo abre crea su cuenta y ya queda como miembro.
   */
  const handleCopyURL = async () => {
    if (!currentBoardId) {
      alert('Primero abri o crea una pizarra.');
      return;
    }
    try {
      const inv = await api.crearInvitacion(currentBoardId, { rol: 'editor' });
      const enlace = `${window.location.origin}${window.location.pathname}?invitacion=${encodeURIComponent(inv.token)}`;
      try {
        await navigator.clipboard.writeText(enlace);
        alert(
          `Enlace de invitacion copiado.\n\nEntra como editor y vence el ` +
            `${new Date(inv.expiraEn).toLocaleDateString()}.\n\n${enlace}`
        );
      } catch {
        // El portapapeles puede estar bloqueado (http sin permiso, o el foco
        // perdido): el enlace igual tiene que llegar a manos del usuario.
        window.prompt('Copia este enlace de invitacion:', enlace);
      }
    } catch (error) {
      alert(
        error instanceof Error
          ? `No se pudo crear la invitacion: ${error.message}`
          : 'No se pudo crear la invitacion'
      );
    }
  };

  const handleClearBoard = async () => {
    const confirmed = window.confirm(
      '¿Estás seguro de que quieres limpiar toda la pizarra?\n\n' +
        'Esta acción eliminará todos los nodos y relaciones del diagrama actual.\n' +
        'No se puede deshacer.'
    );

    if (!confirmed) return;

    try {
      // Obtener todos los nodos y edges actuales
      const allNodes = storeNodes || [];
      const allEdges = storeEdges || [];

      // Crear operaciones de eliminación para todos los elementos
      const nodeChanges = allNodes.map(node => ({ id: node.id, type: 'remove' }));
      const edgeChanges = allEdges.map(edge => ({ id: edge.id, type: 'remove' }));

      // Aplicar los cambios
      if (nodeChanges.length > 0) {
        onNodesChange(nodeChanges as any);
      }
      if (edgeChanges.length > 0) {
        onEdgesChange(edgeChanges as any);
      }

      // Guardar los cambios en Supabase
      await saveDiagram();

      console.log(
        `🗑️ Pizarra limpiada: ${nodeChanges.length} nodos y ${edgeChanges.length} relaciones eliminados`
      );
    } catch (error) {
      console.error('❌ Error limpiando pizarra:', error);
    }
  };

  return (
    <div
      className='canvas-root'
      // Arrastrar un archivo al lienzo es la forma mas directa de abrirlo:
      // funciona con el .eapx de Enterprise Architect y con JSON y XMI.
      onDragOver={e => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setArrastrando(true);
      }}
      onDragLeave={e => {
        // Solo se apaga cuando el puntero sale de la raiz, no al pasar por un
        // hijo: si no, el aviso parpadea mientras se arrastra por encima.
        if (e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) return;
        setArrastrando(false);
      }}
      onDrop={e => {
        if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        setArrastrando(false);
        void importarArchivo(e.dataTransfer.files[0]);
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onMouseDown={e => {
        // Solo cerrar el menú si el clic no fue en la barra de herramientas
        const toolbar = e.currentTarget.querySelector('[data-toolbar="true"]');
        if (toolbar && !toolbar.contains(e.target as Node)) {
          handleCanvasMouseDown(e);
          // Cerrar menú de pizarras al hacer clic en el canvas
          if (showBoardMenu) {
            setShowBoardMenu(false);
          }
        }
      }}
    >
      <Toolbar
        boards={boards}
        currentBoardId={currentBoardId}
        currentBoardName={currentBoardData?.name ?? 'Pizarra'}
        onSelectBoard={switchToBoard}
        onCreateBoard={createNewBoard}
        onRenameBoard={renameBoardPrompt}
        onDeleteBoard={deleteBoardConfirm}
        onAddClass={addNode}
        onOpenAssistant={() => setIsPromptOpen(true)}
        onStartManyToMany={handleStartManyToMany}
        onClearBoard={handleClearBoard}
        onImportImage={handleImportImage}
        onImportFile={handleImportJSON}
        onImportEa={handleImportEa}
        onScriptExportarEa={handleScriptExportarEa}
        onExport={handleExportJSON}
        formato={formatoCase}
        onFormatoChange={setFormatoCase}
        importing={importing}
        importProgress={importProgress}
        onGenerateBackend={handleGenerarBackend}
        onGenerateFrontend={handleGenerarFrontend}
        onCopyUrl={handleCopyURL}
        onOpenAjustesIa={() => setAjustesIaAbiertos(true)}
      />

      {ajustesIaAbiertos && <AjustesIaPanel onCerrar={() => setAjustesIaAbiertos(false)} />}

      <ZoomDock
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReset={handleResetZoom}
        onFitAll={handleFitAll}
      />

      {/* El aviso de modo solo existe mientras hay un modo activo */}
      {currentMode === 'manyToMany' && (
        <ModeBanner
          texto={
            manyToManyMode?.sourceId
              ? 'Muchos a muchos: elegí la segunda clase'
              : 'Muchos a muchos: elegí la primera clase'
          }
          onCancel={cancelCurrentMode}
        />
      )}
      {currentMode === 'relation' && (
        <ModeBanner
          texto={
            relationMode?.sourceId
              ? 'Relación: elegí la clase destino'
              : 'Relación: elegí la clase origen'
          }
          onCancel={cancelCurrentMode}
        />
      )}

      {arrastrando && (
        <div className='soltar-aqui'>Soltá el archivo para abrirlo (.eapx, .json o .xmi)</div>
      )}

      {ea && (
        <SelectorDiagramaEa
          archivo={ea.archivo}
          diagramas={ea.diagramas}
          onElegir={d => void elegirDiagramaEa(d)}
          onCancelar={() => setEa(null)}
        />
      )}

      {/* Hidden inputs */}
      <input ref={jsonInputRef} type='file' accept='.eapx,.eap,.json,.xmi,.xml' style={{ display: 'none' }} onChange={handleJSONFileSelect} />
      <input
        ref={eaInputRef}
        type='file'
        accept='.eapx,.eap'
        style={{ display: 'none' }}
        onChange={handleJSONFileSelect}
      />
      <input ref={fileInputRef} type='file' accept='image/*' onChange={handleFileSelect} style={{ display: 'none' }} />

      {/* Canvas */}
      <div
        style={{
          transform: `scale(${zoom}) translate(${panOffset.x}px, ${panOffset.y}px)`,
          transformOrigin: 'top left',
          width: '100%',
          height: '100%',
        }}
      >
        <EdgeLayer
          nodes={nodes}
          edges={edges.map(edge => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            tipo: (edge.data?.edgeType || 'asociacion') as EdgeType['tipo'],
            multiplicidadOrigen: (edge.data?.sourceMultiplicity || '1') as '1' | '*',
            multiplicidadDestino: (edge.data?.targetMultiplicity || '1') as '1' | '*',
          }))}
          onDeleteEdge={deleteEdge}
        />
        {nodes.map(n => (
          <Node
            key={n.id}
            node={n}
            onMouseDown={handleMouseDown}
            addAttribute={addAttribute}
            onStartRelation={handleStartRelation}
            relationMode={!!relationMode}
            isRelationOrigin={relationMode?.sourceId === n.id}
            onSelectAsTarget={handleSelectAsTarget}
            onClick={() => {
              if (manyToManyMode) {
                if (!manyToManyMode.sourceId) handleSelectManyToManySource(n.id);
                else handleSelectManyToManyTarget(n.id);
              }
            }}
            onEditLabel={editNodeLabel}
            onEditAttribute={editAttribute}
            onDeleteAttribute={deleteAttribute}
            onDeleteNode={removeNodeAndEdges}
          />
        ))}
      </div>

      {/* Import overlay */}
      {importing && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.8)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
          }}
        >
          <div style={{ background: '#333', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '18px', marginBottom: '10px' }}>📤 Importando diagrama...</div>
            <div style={{ fontSize: '14px', opacity: 0.8 }}>{importProgress || 'Procesando imagen...'}</div>
          </div>
        </div>
      )}

      {/* 🆕 Modal del Asistente UML */}
      <UmlPrompt
        isOpen={isPromptOpen}
        onClose={() => setIsPromptOpen(false)}
        existingNodes={nodes}
        existingEdges={edges.map(convertReactFlowToUMLEdge)}
      />
    </div>
  );
};

export default BoardPage;
