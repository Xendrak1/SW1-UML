EJEMPLO DE DIAGRAMA SIMPLE M:N:

```
  Cliente         Venta         DetalleVenta         Producto
┌─────────┐   1   ┌─────────┐ 1   ┌─────────────┐ *   ┌─────────┐
│nombre   │─────→ │fecha    │─────→│cantidad     │←────│nombre   │
│apellido │       │total    │     │precio       │     │precio   │
└─────────┘       └─────────┘     └─────────────┘     └─────────┘
```

RELACIONES ESPERADAS:
1. Cliente → Venta (1:*)
2. Venta → DetalleVenta (1:*)  ← Parte del M:N
3. Producto → DetalleVenta (1:*) ← Parte del M:N

RESULTADO ESPERADO:
- DetalleVenta: { asociativa: true, relaciona: ['Venta', 'Producto'] }
- Visualización: Línea discontinua especial Venta ↔ Producto vía DetalleVenta
- Generadores: Campos foráneos automáticos en DetalleVenta hacia Venta y Producto