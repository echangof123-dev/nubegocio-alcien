-- Tipos de negocio nuevos propuestos por la IA.
begin;

insert into auth.usuario (id, celular) values ('00000000-0000-0000-0000-0000000000d1', '+593990000041');

set local role alcien_app;

do $$
declare
  v_codigo text;
  v_otra text;
  v_negocio uuid;
begin
  v_codigo := catalogo.registrar_tipo_ia(
    'Venta de repuestos de bicicleta',
    'F06',
    array['repuestos bici', 'bicicletería'],
    array['Repuestos', 'Llantas', 'Accesorios'],
    '[{"categoria":"Repuestos","nombre":"Cadena","unidad":"Unidad"},
      {"categoria":"Llantas","nombre":"Neumático aro 26","unidad":"Unidad"},
      {"categoria":"Accesorios","nombre":"Casco"},
      {"categoria":"","nombre":"Sin categoría"}]'::jsonb);

  assert v_codigo like 'IA%', 'código de tipo IA';
  assert (select estado from catalogo.tipo_negocio where codigo = v_codigo) = 'pendiente', 'queda pendiente de revisión';
  assert (select count(*) from catalogo.plantilla_producto pp join catalogo.tipo_negocio t on t.id = pp.tipo_negocio_id
          where t.codigo = v_codigo) = 3, 'se descartan productos sin categoría';
  assert (select unidad from catalogo.plantilla_producto where nombre = 'Casco') = 'Unidad', 'unidad por defecto';

  -- No aparece en la búsqueda de otros hasta aprobarse
  assert not exists (select 1 from catalogo.buscar_tipos('repuestos de bicicleta', 10) where codigo = v_codigo),
    'un tipo pendiente no aparece en la búsqueda';

  -- Pero sirve de inmediato para quien lo pidió
  v_negocio := app.crear_negocio('00000000-0000-0000-0000-0000000000d1', v_codigo, 'Bici Taller');
  assert (select count(*) from app.producto) = 3, 'el negocio recibe los productos propuestos';
  assert (select count(*) from app.categoria) = 3, 'y sus categorías';

  -- Mismo nombre (con otras tildes/mayúsculas) reutiliza el tipo
  v_otra := catalogo.registrar_tipo_ia('VENTA DE REPUESTOS DE BICICLETA', 'F06', '{}', '{}', '[]');
  assert v_otra = v_codigo, 'no se duplica el tipo';

  -- Un nombre que ya existe en el catálogo devuelve el existente
  assert catalogo.registrar_tipo_ia('Ferretería', 'F09', '{}', '{}', '[]') = 'T109', 'reutiliza tipos aprobados';

  -- Validaciones
  begin
    perform catalogo.registrar_tipo_ia('Algo', 'F99', '{}', '{}', '[]');
    assert false, 'familia inválida';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform catalogo.registrar_tipo_ia('xy', 'F06', '{}', '{}', '[]');
    assert false, 'nombre muy corto';
  exception when invalid_parameter_value then null;
  end;
end $$;

reset role;
rollback;
