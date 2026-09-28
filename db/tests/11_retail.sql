-- Tanda 3 de módulos: variantes, listas de precios, series y garantías, catálogo en línea.
begin;

insert into auth.usuario (id, celular) values
  ('00000000-0000-0000-0000-0000000000d1', '+593990000091'),   -- dueña de la tienda de ropa
  ('00000000-0000-0000-0000-0000000000d2', '+593990000092');   -- cajera

create temp table ids (clave text primary key, id uuid);
grant select, insert, update on ids to alcien_app;
insert into ids values ('ropa', app.crear_negocio('00000000-0000-0000-0000-0000000000d1', 'T061', 'Ropa D'));
insert into app.membresia (usuario_id, negocio_id, rol)
select '00000000-0000-0000-0000-0000000000d2', id, 'cajero' from ids where clave = 'ropa';

create function pg_temp.prod(n text) returns uuid language sql as $$ select id from app.producto where nombre = n $$;
create function pg_temp.dueña() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-0000000000d1', (select id from ids where clave = 'ropa'));
$$;
create function pg_temp.cajera() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-0000000000d2', (select id from ids where clave = 'ropa'));
$$;
grant execute on function pg_temp.prod(text), pg_temp.dueña(), pg_temp.cajera() to alcien_app;

select set_config('app.negocio_id', '', true);
set local role alcien_app;

-- ---------- Variantes ----------
do $$
declare
  n int;
begin
  perform pg_temp.dueña();
  insert into app.producto (negocio_id, nombre, unidad, precio, costo) values (app.negocio_actual(), 'Camiseta básica', 'Unidad', 12, 5);
  n := app.crear_variantes(pg_temp.prod('Camiseta básica'), '[["S","M","L"],["Blanco","Negro"]]', 3);
  assert n = 6, format('3 tallas × 2 colores = 6 (salió %s)', n);
  assert app.crear_variantes(pg_temp.prod('Camiseta básica'), '[["S","M","L","XL"],["Blanco","Negro"]]') = 2, 'solo se agregan las nuevas (XL)';
  assert (select stock from app.producto where nombre = 'Camiseta básica · M · Negro') = 3, 'stock por variante';
  assert (select precio from app.producto where nombre = 'Camiseta básica · L · Blanco') = 12, 'precio heredado';
  assert not (select maneja_stock from app.producto where nombre = 'Camiseta básica'), 'el modelo no lleva stock';

  -- Una variante con precio propio no cambia con el modelo
  update app.producto set precio = 14 where nombre = 'Camiseta básica · XL · Negro';
  update app.producto set precio = 13 where nombre = 'Camiseta básica';
  assert (select precio from app.producto where nombre = 'Camiseta básica · S · Blanco') = 13, 'sube con el modelo';
  assert (select precio from app.producto where nombre = 'Camiseta básica · XL · Negro') = 14, 'la de precio propio se queda';
  perform app.abrir_caja(0);
  -- Listas de precios, series y catálogo no vienen con la ropa: se activan
  perform app.activar_modulo('M17');
  perform app.activar_modulo('M23');
  perform app.activar_modulo('M18');
end $$;

-- ---------- Listas de precios ----------
do $$
declare
  l uuid;
  r record;
begin
  perform pg_temp.dueña();
  insert into app.lista_precio (negocio_id, nombre, descuento_pct) values (app.negocio_actual(), 'Mayorista', 10) returning id into l;
  insert into ids values ('mayorista', l);
  insert into app.lista_precio_item (negocio_id, lista_id, producto_id, desde_cantidad, precio) values
    (app.negocio_actual(), l, pg_temp.prod('Camiseta básica'), 1, 11),
    (app.negocio_actual(), l, pg_temp.prod('Camiseta básica'), 12, 9.5);
  assert app.precio_lista(pg_temp.prod('Camiseta básica · M · Negro'), l, 1) = 11, 'la variante usa el precio del modelo en la lista';
  assert app.precio_lista(pg_temp.prod('Camiseta básica · M · Negro'), l, 12) = 9.5, 'por volumen desde 12';
  insert into app.producto (negocio_id, nombre, unidad, precio) values (app.negocio_actual(), 'Medias', 'Par', 3);
  assert app.precio_lista(pg_temp.prod('Medias'), l, 1) = 2.70, 'sin precio propio: 10 % menos';

  -- La cajera vende con la lista (aunque no puede cambiar precios a mano)
  perform pg_temp.cajera();
  select * into r from app.registrar_venta_lista(
    jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Camiseta básica · M · Negro'), 'cantidad', 2)),
    '[{"metodo":"efectivo","monto":22}]', null, 'nota', null, l);
  assert r.total = 22, 'venta a precio mayorista';
  assert current_setting('app.rol') = 'cajero', 'el rol vuelve a ser cajero';
  assert (select stock from app.producto where nombre = 'Camiseta básica · M · Negro') = 1, 'baja el stock de la variante';
  insert into ids values ('venta_lista', r.venta_id);
end $$;

-- ---------- Series y garantías ----------
do $$
declare
  s app.serie%rowtype;
  v uuid;
begin
  perform pg_temp.dueña();
  insert into app.producto (negocio_id, nombre, unidad, precio, garantia_meses) values (app.negocio_actual(), 'Celular X1', 'Unidad', 199, 12);
  perform app.ajustar_stock(pg_temp.prod('Celular X1'), 2);
  insert into app.serie (negocio_id, producto_id, serie) values (app.negocio_actual(), pg_temp.prod('Celular X1'), 'IMEI-111');
  select venta_id into v from app.registrar_venta(
    jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Celular X1'), 'cantidad', 1)),
    '[{"metodo":"tarjeta","monto":199}]');
  s := app.vender_serie(v, pg_temp.prod('Celular X1'), 'IMEI-111');
  assert s.estado = 'vendida' and s.garantia_hasta = (now() at time zone 'America/Guayaquil')::date + interval '12 months', 'garantía de 12 meses';
  begin
    perform app.vender_serie(v, pg_temp.prod('Celular X1'), 'IMEI-111');
    assert false, 'una serie no se vende dos veces';
  exception when unique_violation then null;
  end;
  perform app.anular_venta(v, 'Devolución');
  assert (select estado from app.serie where serie = 'IMEI-111') = 'en_stock', 'la serie vuelve al stock';
end $$;

-- ---------- Catálogo en línea ----------
do $$
declare
  c jsonb;
  p jsonb;
begin
  perform pg_temp.dueña();
  insert into app.catalogo_config (negocio_id, slug, whatsapp, costo_envio) values (app.negocio_actual(), 'ropa-d', '593991112233', 2);
  insert into app.catalogo_oculto (negocio_id, producto_id) values (app.negocio_actual(), pg_temp.prod('Medias'));
  perform app.activar_modulo('M10');
  insert into ids values ('s_blanco', pg_temp.prod('Camiseta básica · S · Blanco')), ('medias', pg_temp.prod('Medias'));
end $$;

reset role;
set local role alcien_app;
select set_config('app.negocio_id', '', true);

do $$
declare
  c jsonb;
  p jsonb;
begin
  c := app.catalogo_publico('ROPA-D');
  assert c->>'negocio' = 'Ropa D', 'catálogo público sin sesión';
  assert not exists (select 1 from jsonb_array_elements(c->'productos') x where x->>'nombre' = 'Medias'), 'lo oculto no sale';
  assert jsonb_array_length((select x->'variantes' from jsonb_array_elements(c->'productos') x where x->>'nombre' = 'Camiseta básica')) = 6,
    'solo las variantes con stock (las XL se crearon sin stock)';
  assert (c->>'acepta_pedidos')::boolean, 'acepta pedidos';

  p := app.catalogo_pedido('ropa-d', jsonb_build_object('nombre', 'Lucía', 'celular', '0998887766', 'tipo', 'domicilio',
    'direccion', 'Cdla. Kennedy', 'items', jsonb_build_array(
      jsonb_build_object('producto_id', (select id from ids where clave = 's_blanco'), 'cantidad', 2))));
  assert (p->>'total')::numeric = 28, format('2 × 13 + 2 de envío = 28 (salió %s)', p->>'total');
  assert coalesce(current_setting('app.negocio_id', true), '') = '', 'no deja el contexto del negocio abierto';
  begin
    perform app.catalogo_pedido('ropa-d', jsonb_build_object('nombre', 'X', 'celular', '1', 'items',
      jsonb_build_array(jsonb_build_object('producto_id', (select id from ids where clave = 'medias'), 'cantidad', 1))));
    assert false, 'no se pide lo oculto';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- El pedido entró al negocio por el canal catálogo
do $$
begin
  perform pg_temp.dueña();
  assert (select count(*) from app.pedido where canal = 'catalogo' and nombre = 'Lucía') = 1, 'pedido del catálogo';
end $$;

rollback;
