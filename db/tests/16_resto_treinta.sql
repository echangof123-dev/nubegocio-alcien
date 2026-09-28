-- Tanda 7: deudas a mano, combos, propina, productos sin ventas, jornada y balance con pagos a proveedores.
begin;

insert into auth.usuario (id, celular) values
  ('00000000-0000-0000-0000-000000000301', '+593990000141'),
  ('00000000-0000-0000-0000-000000000302', '+593990000142');

create temp table ids (clave text primary key, id uuid);
grant select, insert, update on ids to alcien_app;
insert into ids values ('neg', app.crear_negocio('00000000-0000-0000-0000-000000000301', 'T001', 'Resto R'));
insert into app.membresia (usuario_id, negocio_id, rol)
select '00000000-0000-0000-0000-000000000302', id, 'cajero' from ids where clave = 'neg';

create function pg_temp.id(c text) returns uuid language sql as $$ select id from ids where clave = c $$;
create function pg_temp.dueño() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-000000000301', (select id from ids where clave = 'neg'));
$$;
create function pg_temp.cajero() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-000000000302', (select id from ids where clave = 'neg'));
$$;
grant execute on function pg_temp.id(text), pg_temp.dueño(), pg_temp.cajero() to alcien_app;

select set_config('app.negocio_id', '', true);
set local role alcien_app;

-- ---------- Deudas a mano ----------
do $$
declare
  c uuid; pr uuid; d uuid; hoy date := (now() at time zone 'America/Guayaquil')::date;
begin
  perform pg_temp.dueño();
  perform app.abrir_caja(100);
  insert into app.cliente (negocio_id, nombre) values (app.negocio_actual(), 'Don Lucho') returning id into c;
  assert app.registrar_deuda_cliente(c, 20, 'Consumo del mes pasado', hoy + 10) = 20, 'deuda sin venta';
  assert (select fecha_pago from app.cliente where id = c) = hoy + 10, 'fecha de pago';
  assert app.registrar_abono(c, 5, 'efectivo') = 15, 'se abona igual que un fiado';

  insert into app.proveedor (negocio_id, nombre) values (app.negocio_actual(), 'Distribuidora R') returning id into pr;
  d := app.registrar_deuda_proveedor(pr, 150, 'Mercadería de septiembre', hoy + 15);
  assert app.pagar_deuda_proveedor(d, 50, 'efectivo') = 100, 'queda 100';
  assert exists (select 1 from app.caja_movimiento where motivo = 'Pago a Distribuidora R' and monto = 50), 'sale de la caja';
  begin
    perform app.pagar_deuda_proveedor(d, 101, 'efectivo');
    assert false, 'no se paga más de lo que se debe';
  exception when invalid_parameter_value then null;
  end;
  assert app.pagar_deuda_proveedor(d, 100, 'transferencia') = 0, 'saldada';
  assert (select estado from app.deuda_proveedor where id = d) = 'pagada', 'pagada';
  assert (app.balance_periodo(hoy, hoy)->>'egresos')::numeric = 150, 'los pagos al proveedor son egresos';
  assert (app.balance_periodo(hoy, hoy)->>'ingresos')::numeric = 5, 'el abono es ingreso';
end $$;

do $$
begin
  perform pg_temp.cajero();
  begin
    perform app.registrar_deuda_proveedor((select id from app.proveedor limit 1), 10, 'X');
    assert false, 'el cajero no anota deudas con proveedores';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- Combos ----------
do $$
declare
  cafe uuid; pan uuid; combo uuid; r record;
begin
  perform pg_temp.dueño();
  insert into app.producto (negocio_id, nombre, unidad, precio, costo) values (app.negocio_actual(), 'Café R', 'Unidad', 1, 0.3) returning id into cafe;
  insert into app.producto (negocio_id, nombre, unidad, precio, costo) values (app.negocio_actual(), 'Pan R', 'Unidad', 0.25, 0.1) returning id into pan;
  update app.producto set stock = 10 where id in (cafe, pan);
  insert into app.producto (negocio_id, nombre, unidad, precio) values (app.negocio_actual(), 'Combo desayuno R', 'Unidad', 1.5) returning id into combo;
  -- Sin el módulo de recetas (M08) el combo funciona igual
  perform app.desactivar_modulo('M09');
  perform app.desactivar_modulo('M08');
  assert app.guardar_combo(combo, jsonb_build_array(jsonb_build_object('producto_id', cafe, 'cantidad', 1), jsonb_build_object('producto_id', pan, 'cantidad', 2))) = 0.5, 'costo del combo';
  select * into r from app.registrar_venta(jsonb_build_array(jsonb_build_object('producto_id', combo, 'cantidad', 2)), '[{"metodo":"efectivo","monto":3}]');
  assert (select stock from app.producto where id = cafe) = 8 and (select stock from app.producto where id = pan) = 6, 'baja cada componente';
  assert (select costo_unitario from app.venta_detalle where venta_id = r.venta_id) = 0.5, 'costo del combo en la venta';
  perform app.anular_venta(r.venta_id, 'Prueba');
  assert (select stock from app.producto where id = pan) = 10, 'al anular vuelven';
  begin
    perform app.guardar_combo(cafe, jsonb_build_array(jsonb_build_object('producto_id', combo, 'cantidad', 1)));
    assert false, 'un combo no lleva otro combo';
  exception when invalid_parameter_value then null;
  end;
  insert into ids values ('cafe', cafe);
end $$;

-- ---------- Propina en la cuenta de la mesa ----------
do $$
declare
  m uuid; cu uuid; r record;
begin
  perform pg_temp.dueño();
  perform app.activar_modulo('M08');
  perform app.activar_modulo('M09');
  insert into app.mesa (negocio_id, nombre) values (app.negocio_actual(), 'M1 R') returning id into m;
  cu := app.abrir_cuenta(m, null, 2);
  perform app.agregar_a_cuenta(cu, jsonb_build_array(jsonb_build_object('producto_id', pg_temp.id('cafe'), 'cantidad', 2)));
  perform pg_temp.cajero();
  select * into r from app.cobrar_cuenta(cu, null, '[{"metodo":"efectivo","monto":2.2}]', null, 'nota', 0.2);
  assert r.total = 2.2, 'cuenta + propina';
  assert (select d.iva from app.venta_detalle d join app.producto p on p.id = d.producto_id where d.venta_id = r.venta_id and p.tipo = 'propina') = 0, 'la propina no lleva IVA';
  assert (app.recibo_publico((select token_publico from app.venta where id = r.venta_id))->>'propina')::numeric = 0.2, 'el recibo la muestra';
  assert current_setting('app.rol') = 'cajero', 'el rol vuelve';
end $$;

-- ---------- Productos sin ventas y jornada ----------
do $$
declare
  rep jsonb; j jsonb; hoy date := (now() at time zone 'America/Guayaquil')::date;
begin
  perform pg_temp.dueño();
  rep := app.reporte_periodo(hoy - 6, hoy);
  assert exists (select 1 from jsonb_array_elements(rep->'sin_ventas') x where x->>'nombre' = 'Pan R'), 'el pan no se vendió (la venta se anuló)';
  assert not exists (select 1 from jsonb_array_elements(rep->'sin_ventas') x where x->>'nombre' = 'Café R'), 'el café sí';

  perform pg_temp.cajero();
  j := app.marcar_jornada();
  assert j->>'estado' = 'entrada', 'entrada';
  j := app.marcar_jornada();
  assert j->>'estado' = 'salida', 'salida';
  assert (select count(*) from app.jornada) = 1, 'una jornada';
end $$;

rollback;
