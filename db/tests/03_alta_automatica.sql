-- Alta automática: elegir el tipo de negocio deja el sistema configurado.
begin;

insert into auth.usuario (id, celular, nombre)
values ('00000000-0000-0000-0000-00000000000a', '+593990000001', 'Rosa');

do $$
declare
  v_tienda uuid;
  v_ropa uuid;
  v_resto uuid;
  v_pelu uuid;
  n int;
  t text;
begin
  -- ---------- Tienda de barrio (familia Abarrotes y mercado) ----------
  v_tienda := app.crear_negocio('00000000-0000-0000-0000-00000000000a',
                                (select codigo from catalogo.tipo_negocio where nombre = 'Tienda de barrio'),
                                '  Tienda Doña Rosa  ');

  assert (select nombre from app.negocio where id = v_tienda) = 'Tienda Doña Rosa', 'el nombre se guarda sin espacios sobrantes';
  assert app.negocio_actual() = v_tienda, 'el contexto queda en el negocio nuevo';
  assert current_setting('app.rol') = 'dueno', 'quien crea el negocio es dueño';

  -- Módulos activos = núcleo + S de la familia + dependencias
  select count(*) into n
  from catalogo.familia_modulo fm
  where fm.familia = 'F04' and fm.modo = 'S'
    and not exists (select 1 from app.negocio_modulo nm
                    where nm.negocio_id = v_tienda and nm.modulo = fm.modulo and nm.activo);
  assert n = 0, format('%s módulos de la familia quedaron sin activar', n);

  foreach t in array array['M01', 'M02', 'M03', 'M04', 'M06', 'M07', 'M14', 'M19', 'M20', 'M21'] loop
    assert exists (select 1 from app.negocio_modulo where negocio_id = v_tienda and modulo = t and activo),
      format('la tienda debería tener %s activo', t);
  end loop;
  assert not exists (select 1 from app.negocio_modulo where negocio_id = v_tienda and modulo = 'M09'),
    'una tienda no tiene mesas y comandas';

  -- Opcionales quedan sugeridos y apagados
  select count(*) into n from app.negocio_modulo
  where negocio_id = v_tienda and origen = 'sugerido' and not activo;
  assert n = (select count(*) from catalogo.familia_modulo where familia = 'F04' and modo = 'O'),
    'los módulos opcionales quedan sugeridos';

  -- Configuración, suscripción y membresía
  assert (select palabra_items from app.negocio_config where negocio_id = v_tienda) = 'Productos', 'vocabulario';
  assert (select plan || '/' || estado from app.suscripcion where negocio_id = v_tienda) = 'negocio/prueba', 'prueba del plan Negocio';
  assert (select vence_en::date - now()::date from app.suscripcion where negocio_id = v_tienda) = 14, 'la prueba dura 14 días';
  assert (select rol from app.membresia where negocio_id = v_tienda) = 'dueno', 'membresía de dueño';

  -- Categorías del tipo y productos de ejemplo, sin precio
  assert exists (select 1 from app.categoria where negocio_id = v_tienda and nombre = 'Abarrotes' and orden = 1), 'primera categoría';
  assert exists (select 1 from app.categoria where negocio_id = v_tienda and nombre = 'Panadería'), 'categoría que solo aparece en la ficha';
  select count(*) into n from app.producto where negocio_id = v_tienda;
  assert n = (select count(*) from catalogo.plantilla_producto pp join catalogo.tipo_negocio tn on tn.id = pp.tipo_negocio_id
              where tn.nombre = 'Tienda de barrio'), 'se copian todos los productos de ejemplo';
  assert not exists (select 1 from app.producto where negocio_id = v_tienda and (precio is not null or not es_ejemplo)),
    'los productos de ejemplo llegan sin precio y marcados como ejemplo';
  assert (select unidad from app.producto where negocio_id = v_tienda and nombre = 'Queso fresco') = 'Libra', 'unidad de la ficha';

  -- Al editar un producto de ejemplo deja de serlo
  update app.producto set precio = 1.35 where negocio_id = v_tienda and nombre = 'Arroz 1 kg';
  assert not (select es_ejemplo from app.producto where negocio_id = v_tienda and nombre = 'Arroz 1 kg'), 'editado deja de ser ejemplo';

  -- ---------- Tienda de ropa: variantes ----------
  v_ropa := app.crear_negocio('00000000-0000-0000-0000-00000000000a',
                              (select codigo from catalogo.tipo_negocio where nombre = 'Tienda de ropa'), 'Moda Rosa');
  assert exists (select 1 from app.negocio_modulo where negocio_id = v_ropa and modulo = 'M05' and activo), 'ropa usa variantes';
  assert (select variantes from app.producto where negocio_id = v_ropa and nombre = 'Blusa') like 'Talla%', 'las tallas vienen de la ficha';

  -- ---------- Restaurante: mesas, recetas por dependencia, "Platos" ----------
  v_resto := app.crear_negocio('00000000-0000-0000-0000-00000000000a',
                               (select codigo from catalogo.tipo_negocio where nombre = 'Restaurante'), 'La Sazón');
  assert exists (select 1 from app.negocio_modulo where negocio_id = v_resto and modulo = 'M09' and activo), 'restaurante con mesas';
  assert exists (select 1 from app.negocio_modulo where negocio_id = v_resto and modulo = 'M08' and activo), 'recetas activas';
  assert (select palabra_items from app.negocio_config where negocio_id = v_resto) = 'Platos', 'restaurante habla de platos';

  -- ---------- Peluquería: los servicios no manejan stock ----------
  v_pelu := app.crear_negocio('00000000-0000-0000-0000-00000000000a',
                              (select codigo from catalogo.tipo_negocio where nombre = 'Peluquería'), 'Salón Rosa');
  assert (select maneja_stock from app.producto where negocio_id = v_pelu and nombre = 'Corte dama') = false, 'servicios sin stock';
  assert (select maneja_stock from app.producto where negocio_id = v_pelu and nombre = 'Shampoo') = true, 'productos con stock';
  assert (select palabra_items from app.negocio_config where negocio_id = v_pelu) = 'Servicios', 'peluquería habla de servicios';

  -- Un tipo sin ficha de productos igual queda con sus categorías
  perform app.crear_negocio('00000000-0000-0000-0000-00000000000a',
                            (select codigo from catalogo.tipo_negocio where nombre = 'Heladería'), 'Helados Rosa');
  assert (select count(*) from app.categoria where negocio_id = app.negocio_actual()) = 4, 'heladería: 4 categorías';

  -- La usuaria ve sus 5 negocios
  assert (select count(*) from app.mis_negocios('00000000-0000-0000-0000-00000000000a')) = 5, 'cinco negocios';
end $$;

-- Errores esperados
do $$
begin
  begin
    perform app.crear_negocio('00000000-0000-0000-0000-00000000000a', 'T999', 'X');
    assert false, 'un tipo inexistente debe fallar';
  exception when sqlstate 'P0002' then null;
  end;

  begin
    perform app.crear_negocio('00000000-0000-0000-0000-0000000000ff', 'T001', 'X');
    assert false, 'un usuario inexistente debe fallar';
  exception when sqlstate 'P0002' then null;
  end;

  begin
    perform app.crear_negocio('00000000-0000-0000-0000-00000000000a', 'T001', '   ');
    assert false, 'un nombre vacío debe fallar';
  exception when check_violation then null;
  end;

  begin
    perform app.crear_negocio('00000000-0000-0000-0000-00000000000a', 'T001', 'Con RUC malo', '123');
    assert false, 'un RUC de menos de 13 dígitos debe fallar';
  exception when check_violation then null;
  end;
end $$;

rollback;
