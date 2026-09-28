-- Tanda 6: gastos con fecha y anulación, venta libre, recibo público, carga masiva, balance.
begin;

insert into auth.usuario (id, celular, nombre) values
  ('00000000-0000-0000-0000-000000000101', '+593990000121', 'Doña Rosa'),
  ('00000000-0000-0000-0000-000000000102', '+593990000122', 'Cajera Ana');

create temp table ids (clave text primary key, id uuid);
grant select, insert, update on ids to alcien_app;
insert into ids values ('tienda', app.crear_negocio('00000000-0000-0000-0000-000000000101', 'T061', 'Tienda R'));
insert into app.membresia (usuario_id, negocio_id, rol)
select '00000000-0000-0000-0000-000000000102', id, 'cajero' from ids where clave = 'tienda';

create function pg_temp.id(c text) returns uuid language sql as $$ select id from ids where clave = c $$;
create function pg_temp.dueña() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-000000000101', (select id from ids where clave = 'tienda'));
$$;
create function pg_temp.cajera() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-000000000102', (select id from ids where clave = 'tienda'));
$$;
grant execute on function pg_temp.id(text), pg_temp.dueña(), pg_temp.cajera() to alcien_app;

select set_config('app.negocio_id', '', true);
set local role alcien_app;

-- ---------- Gastos ----------
do $$
declare
  g1 uuid; g2 uuid; hoy date := (now() at time zone 'America/Guayaquil')::date;
begin
  perform pg_temp.dueña();
  -- Sin caja abierta también se registra
  g1 := app.registrar_gasto_v2(jsonb_build_object('categoria', 'Arriendo', 'monto', 300, 'metodo', 'transferencia', 'fecha', hoy - 3));
  assert (select fecha from app.gasto where id = g1) = hoy - 3, 'fecha pasada';
  begin
    perform app.registrar_gasto_v2(jsonb_build_object('categoria', 'Arriendo', 'monto', 1, 'fecha', hoy + 1));
    assert false, 'no se registran gastos futuros';
  exception when invalid_parameter_value then null;
  end;
  perform app.abrir_caja(100);
  g2 := app.registrar_gasto_v2(jsonb_build_object('categoria', 'Transporte', 'monto', 5, 'metodo', 'efectivo'));
  assert (select turno_id from app.gasto where id = g2) = app.turno_abierto(), 'el gasto de hoy en efectivo sale de la caja';
  assert (select gastos_efectivo from app.resumen_caja()) = 5, 'la caja lo cuenta';
  perform app.anular_gasto(g2);
  assert (select gastos_efectivo from app.resumen_caja()) = 0, 'anulado ya no cuenta en la caja';
  insert into ids values ('gasto_arriendo', g1);
end $$;

do $$
begin
  perform pg_temp.cajera();
  begin
    perform app.anular_gasto(pg_temp.id('gasto_arriendo'));
    assert false, 'la cajera no anula gastos';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- Venta libre y recibo ----------
do $$
declare
  r record; rec jsonb;
begin
  perform pg_temp.cajera();   -- la cajera puede cobrar un monto libre
  select * into r from app.registrar_venta_libre(12.5, 'Arreglo de basta', '[{"metodo":"efectivo","monto":12.5,"recibido":20}]');
  assert r.total = 12.5 and r.vuelto = 7.5, 'venta libre con vuelto';
  assert (select nombre from app.venta_detalle where venta_id = r.venta_id) = 'Arreglo de basta', 'el concepto queda en la línea';
  assert (select count(*) from app.producto where tipo = 'libre') = 1, 'un solo producto oculto';
  perform app.registrar_venta_libre(3, null, '[{"metodo":"efectivo","monto":3}]');
  assert (select count(*) from app.producto where tipo = 'libre') = 1, 'se reutiliza';

  rec := app.recibo_publico((select token_publico from app.venta where id = r.venta_id));
  assert rec->>'negocio' = 'Tienda R', 'recibo con el negocio';
  assert (rec->'lineas'->0->>'nombre') = 'Arreglo de basta', 'recibo con la línea';
  assert (rec->'pagos'->0->>'vuelto')::numeric = 7.5, 'recibo con el vuelto';
  assert app.recibo_publico('nada') is null, 'token inválido';
  insert into ids values ('venta_libre', r.venta_id);
end $$;

-- ---------- Carga masiva ----------
do $$
declare
  r jsonb;
begin
  perform pg_temp.dueña();
  r := app.importar_productos('[
    {"nombre":"Jean Excel","categoria":"Pantalones Excel","precio":"25","costo":"12","stock":"10","codigo_barras":"7861234567897"},
    {"nombre":"Camisa Excel","precio":"15.5","stock":"4","stock_minimo":"2"},
    {"nombre":"","precio":"1"},
    {"nombre":"Malo Excel","precio":"abc"},
    {"nombre":"Otro Excel","codigo_barras":"7861234567897"}
  ]');
  assert (r->>'nuevos')::int = 2, format('dos nuevos (%s)', r);
  assert jsonb_array_length(r->'errores') = 3, format('tres errores (%s)', r->'errores');
  assert (select stock from app.producto where nombre = 'Jean Excel') = 10, 'stock inicial';
  assert exists (select 1 from app.categoria where nombre = 'Pantalones Excel'), 'crea la categoría';

  r := app.importar_productos('[{"nombre":"jean excel","precio":"27","stock":"7"}]');
  assert (r->>'actualizados')::int = 1, 'actualiza por nombre sin importar mayúsculas';
  assert (select precio from app.producto where nombre = 'Jean Excel') = 27, 'nuevo precio';
  assert (select stock from app.producto where nombre = 'Jean Excel') = 7, 'ajusta el stock';
  assert exists (select 1 from app.movimiento_inventario m join app.producto p on p.id = m.producto_id
                 where p.nombre = 'Jean Excel' and m.tipo = 'ajuste' and m.cantidad = -3), 'queda el ajuste en el historial';
end $$;

do $$
begin
  perform pg_temp.cajera();
  begin
    perform app.importar_productos('[{"nombre":"X"}]');
    assert false, 'la cajera no carga productos';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- Balance ----------
do $$
declare
  b jsonb; c uuid; r record; hoy date := (now() at time zone 'America/Guayaquil')::date;
begin
  perform pg_temp.dueña();
  perform app.activar_modulo('M14');
  insert into app.cliente (negocio_id, nombre) values (app.negocio_actual(), 'Vecino') returning id into c;
  select * into r from app.registrar_venta(
    jsonb_build_array(jsonb_build_object('producto_id', (select id from app.producto where nombre = 'Camisa Excel'), 'cantidad', 2)),
    '[{"metodo":"fiado","monto":31}]', c);
  perform app.registrar_abono(c, 10, 'efectivo');
  b := app.balance_periodo(hoy - 6, hoy);
  -- Ingresos: 12,50 + 3 (ventas libres) + 10 (abono). El fiado no es ingreso hasta que pagan.
  assert (b->>'ingresos')::numeric = 25.5, format('ingresos 25,50 (salió %s)', b->>'ingresos');
  assert (b->>'egresos')::numeric = 300, 'egresos: el arriendo (el gasto anulado no cuenta)';
  assert (b->>'fiado')::numeric = 31, 'vendido a fiado aparte';
  assert (b->>'ventas')::int = 3, 'tres ventas';
  assert exists (select 1 from jsonb_array_elements(b->'movimientos') m where m->>'tipo' = 'abono'), 'el abono sale en la lista';
  assert (app.reporte_periodo(hoy - 6, hoy)->>'gastos')::numeric = 300, 'el reporte usa la fecha del gasto y excluye anulados';
end $$;

rollback;
