-- Tanda 2 de módulos: recetas, mesas y comandas, pedidos y delivery.
begin;

insert into auth.usuario (id, celular) values
  ('00000000-0000-0000-0000-0000000000b1', '+593990000081'),   -- dueño del restaurante
  ('00000000-0000-0000-0000-0000000000b2', '+593990000082');   -- mesero (cajero)

create temp table ids (clave text primary key, id uuid);
grant select, insert, update on ids to alcien_app;
insert into ids values ('resto', app.crear_negocio('00000000-0000-0000-0000-0000000000b1', 'T001', 'Restaurante B'));
insert into app.membresia (usuario_id, negocio_id, rol)
select '00000000-0000-0000-0000-0000000000b2', id, 'cajero' from ids where clave = 'resto';

create function pg_temp.prod(n text) returns uuid language sql as $$ select id from app.producto where nombre = n $$;
create function pg_temp.dueño() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-0000000000b1', (select id from ids where clave = 'resto'));
$$;
create function pg_temp.mesero() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-0000000000b2', (select id from ids where clave = 'resto'));
$$;
grant execute on function pg_temp.prod(text), pg_temp.dueño(), pg_temp.mesero() to alcien_app;

select set_config('app.negocio_id', '', true);
set local role alcien_app;

-- ---------- Menú, insumos y recetas ----------
do $$
declare
  costo numeric;
begin
  perform pg_temp.dueño();
  assert app.modulo_activo('M08') and app.modulo_activo('M09') and app.modulo_activo('M10'), 'un restaurante trae recetas, mesas y pedidos';
  insert into app.producto (negocio_id, nombre, unidad, precio, costo, tipo, maneja_stock) values
    (app.negocio_actual(), 'Arroz (insumo)', 'Kilo', null, 1.20, 'insumo', true),
    (app.negocio_actual(), 'Pollo (insumo)', 'Kilo', null, 4.00, 'insumo', true),
    (app.negocio_actual(), 'Arroz con pollo', 'Plato', 4.50, null, 'venta', true),
    (app.negocio_actual(), 'Limonada', 'Vaso', 1.00, 0.20, 'venta', false);
  perform app.ajustar_stock(pg_temp.prod('Arroz (insumo)'), 10, 'Inicial');
  perform app.ajustar_stock(pg_temp.prod('Pollo (insumo)'), 5, 'Inicial');

  costo := app.guardar_receta(pg_temp.prod('Arroz con pollo'), jsonb_build_array(
    jsonb_build_object('insumo_id', pg_temp.prod('Arroz (insumo)'), 'cantidad', 0.15),
    jsonb_build_object('insumo_id', pg_temp.prod('Pollo (insumo)'), 'cantidad', 0.25)));
  assert costo = 1.18, format('costo del plato 0,15·1,20 + 0,25·4,00 = 1,18 (salió %s)', costo);
  assert not (select maneja_stock from app.producto where nombre = 'Arroz con pollo'), 'el plato no lleva stock propio';

  insert into app.mesa (negocio_id, nombre, zona, orden) values
    (app.negocio_actual(), '1', 'Salón', 1), (app.negocio_actual(), '2', 'Salón', 2), (app.negocio_actual(), 'Terraza 1', 'Terraza', 3);
  perform app.abrir_caja(20);
end $$;

-- ---------- El mesero atiende la mesa 1 ----------
do $$
declare
  c uuid;
  r record;
  i bigint;
begin
  perform pg_temp.mesero();
  c := app.abrir_cuenta((select id from app.mesa where nombre = '1'), null, 3);
  assert app.abrir_cuenta((select id from app.mesa where nombre = '1')) = c, 'la mesa ocupada devuelve su cuenta';
  insert into ids values ('cuenta1', c);

  perform app.agregar_a_cuenta(c, jsonb_build_array(
    jsonb_build_object('producto_id', pg_temp.prod('Arroz con pollo'), 'cantidad', 2, 'nota', 'uno sin cebolla'),
    jsonb_build_object('producto_id', pg_temp.prod('Limonada'), 'cantidad', 3)));
  assert app.enviar_a_cocina(c) = 2, 'dos líneas a cocina';
  assert app.enviar_a_cocina(c) = 0, 'nada nuevo que enviar';

  -- Lo enviado solo lo quita un administrador
  select id into i from app.cuenta_item where cuenta_id = c and nombre = 'Limonada';
  begin
    perform app.quitar_de_cuenta(i);
    assert false, 'el mesero no quita lo enviado';
  exception when insufficient_privilege then null;
  end;

  -- Cocina
  perform app.marcar_cocina((select id from app.cuenta_item where cuenta_id = c and nombre = 'Arroz con pollo'), 'listo');

  -- Mover de mesa
  perform app.mover_cuenta(c, (select id from app.mesa where nombre = 'Terraza 1'));
  assert (select mesa_id from app.cuenta where id = c) = (select id from app.mesa where nombre = 'Terraza 1'), 'cuenta movida';

  -- Dividir: primero paga las limonadas
  select * into r from app.cobrar_cuenta(c, array[i], '[{"metodo":"efectivo","monto":3.00}]');
  assert r.total = 3.00 and not r.cuenta_cerrada, 'cobro parcial de 3,00';
  -- Luego el resto
  select * into r from app.cobrar_cuenta(c, null, '[{"metodo":"efectivo","monto":9.00,"recibido":10}]');
  assert r.total = 9.00 and r.vuelto = 1.00 and r.cuenta_cerrada, 'resto cobrado y cuenta cerrada';
  insert into ids values ('venta_platos', r.venta_id);
  assert (select estado from app.cuenta where id = c) = 'cobrada', 'cuenta cobrada';

  -- Los insumos bajaron por la receta: 2 platos
  assert (select stock from app.producto where nombre = 'Arroz (insumo)') = 9.7, 'arroz 10 − 0,30';
  assert (select stock from app.producto where nombre = 'Pollo (insumo)') = 4.5, 'pollo 5 − 0,50';
  assert (select costo_unitario from app.venta_detalle where venta_id = r.venta_id) = 1.18, 'costo del plato en la venta';
end $$;

-- Anular la venta devuelve los insumos
do $$
begin
  perform pg_temp.dueño();
  perform app.anular_venta((select id from ids where clave = 'venta_platos'), 'Error de cobro');
  assert (select stock from app.producto where nombre = 'Arroz (insumo)') = 10, 'arroz devuelto';
  assert (select stock from app.producto where nombre = 'Pollo (insumo)') = 5, 'pollo devuelto';
end $$;

-- ---------- Pedidos y delivery ----------
do $$
declare
  p uuid;
  r record;
begin
  perform pg_temp.mesero();
  begin
    perform app.crear_pedido(jsonb_build_object('tipo', 'domicilio', 'nombre', 'Ana',
      'items', jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Limonada'), 'cantidad', 1))));
    assert false, 'domicilio sin dirección';
  exception when invalid_parameter_value then null;
  end;

  p := app.crear_pedido(jsonb_build_object('tipo', 'domicilio', 'canal', 'whatsapp', 'nombre', 'Ana', 'celular', '0991112233',
    'direccion', 'Av. Siempre Viva 123', 'costo_envio', 1.50,
    'items', jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Arroz con pollo'), 'cantidad', 1))));
  assert (select subtotal from app.pedido where id = p) = 4.50, 'subtotal del pedido';
  perform app.cambiar_estado_pedido(p, 'preparando');
  perform app.cambiar_estado_pedido(p, 'en_camino', 'Luis');
  select * into r from app.cobrar_pedido(p, '[{"metodo":"efectivo","monto":6.00}]');
  assert r.total = 6.00, 'plato + envío';
  assert exists (select 1 from app.venta_detalle where venta_id = r.venta_id and nombre = 'Envío a domicilio' and total = 1.50), 'el envío es una línea';
  perform app.cambiar_estado_pedido(p, 'entregado');
  begin
    perform app.cambiar_estado_pedido(p, 'cancelado');
    assert false, 'un pedido entregado no se cancela';
  exception when object_not_in_prerequisite_state then null;
  end;

  -- Retiro en el local, cancelado antes de cobrar
  p := app.crear_pedido(jsonb_build_object('tipo', 'retiro', 'nombre', 'Pedro',
    'items', jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Limonada'), 'cantidad', 2))));
  perform app.cambiar_estado_pedido(p, 'cancelado');
  begin
    perform * from app.cobrar_pedido(p, '[{"metodo":"efectivo","monto":2.00}]');
    assert false, 'no se cobra un cancelado';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;

rollback;
