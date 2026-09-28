-- Tanda 5 de módulos: acopio con humedad, impureza y anticipos; reporte por periodo.
begin;

insert into auth.usuario (id, celular, nombre) values
  ('00000000-0000-0000-0000-0000000000f1', '+593990000111', 'Don Pedro'),   -- dueño del centro de acopio
  ('00000000-0000-0000-0000-0000000000f2', '+593990000112', 'Lucho');       -- cajero

create temp table ids (clave text primary key, id uuid);
grant select, insert, update on ids to alcien_app;
insert into ids values ('acopio', app.crear_negocio('00000000-0000-0000-0000-0000000000f1', 'T185', 'Acopio F'));
insert into app.membresia (usuario_id, negocio_id, rol)
select '00000000-0000-0000-0000-0000000000f2', id, 'cajero' from ids where clave = 'acopio';

create function pg_temp.id(c text) returns uuid language sql as $$ select id from ids where clave = c $$;
create function pg_temp.dueño() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-0000000000f1', (select id from ids where clave = 'acopio'));
$$;
create function pg_temp.cajero() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-0000000000f2', (select id from ids where clave = 'acopio'));
$$;
grant execute on function pg_temp.id(text), pg_temp.dueño(), pg_temp.cajero() to alcien_app;

select set_config('app.negocio_id', '', true);
set local role alcien_app;

do $$
begin
  assert app.peso_neto_acopio(110, 10, 7, 7, 0) = 100, 'humedad igual a la de referencia: sin merma';
  assert app.peso_neto_acopio(110, 10, 12, 7, 0) = round(100 * 88 / 93.0, 3), 'merma por humedad';
  assert app.peso_neto_acopio(100, 0, 5, 7, 2) = 98, 'humedad baja: solo la impureza';
end $$;

do $$
declare
  cacao uuid; prod uuid; ant uuid; r record;
begin
  perform pg_temp.dueño();
  perform app.activar_modulo('M25');
  perform app.abrir_caja(500);
  insert into app.producto (negocio_id, nombre, unidad, precio, costo) values (app.negocio_actual(), 'Cacao seco prueba', 'Quintal', 150, null)
  returning id into cacao;
  insert into app.acopio_producto (producto_id, negocio_id, humedad_base, precio_dia) values (cacao, app.negocio_actual(), 7, 120);
  insert into app.proveedor (negocio_id, nombre, ruc, es_productor) values (app.negocio_actual(), 'Juan Chila', '0912345678', true) returning id into prod;
  insert into ids values ('cacao', cacao), ('juan', prod);

  -- Anticipo de $50 en efectivo: sale de la caja
  ant := app.dar_anticipo(prod, 50, 'efectivo', 'Para abono');
  assert exists (select 1 from app.caja_movimiento where motivo = 'Anticipo a Juan Chila' and monto = 50), 'anticipo sale de caja';

  -- 12,5 qq brutos, 0,5 de tara (sacos), 7 % humedad, 1 % impureza, precio del día
  select * into r from app.registrar_acopio(jsonb_build_object('proveedor_id', prod, 'producto_id', cacao, 'sacos', 10,
    'peso_bruto', 12.5, 'tara', 0.5, 'humedad', 7, 'impureza', 1, 'metodo', 'efectivo', 'descontar_anticipo', 30));
  assert r.peso_neto = 11.88, format('12 × 0,99 = 11,88 (salió %s)', r.peso_neto);
  assert r.total = 1425.60, format('11,88 × 120 = 1425,60 (salió %s)', r.total);
  assert r.descontado = 30 and r.a_pagar = 1395.60, 'descuenta el anticipo';
  assert (select saldo from app.anticipo where id = ant) = 20, 'queda $20 de anticipo';
  assert (select stock from app.producto where id = cacao) = 11.88, 'entra al inventario';
  assert (select costo from app.producto where id = cacao) = 120, 'costo del acopio';
  assert (select c.pagado from app.compra c join app.acopio a on a.compra_id = c.id where a.id = r.acopio_id) = 1425.60, 'compra pagada';
  assert (select sum(monto) from app.caja_movimiento where motivo like 'Pago de la compra%') = 1395.60, 'el resto sale de la caja';
  insert into ids values ('acopio1', r.acopio_id);

  begin
    perform app.registrar_acopio(jsonb_build_object('proveedor_id', prod, 'producto_id', cacao, 'peso_bruto', 1, 'descontar_anticipo', 25));
    assert false, 'no se descuenta más anticipo del que hay';
  exception when invalid_parameter_value then null;
  end;

  -- Humedad alta y a crédito: queda como deuda con el productor
  select * into r from app.registrar_acopio(jsonb_build_object('proveedor_id', prod, 'producto_id', cacao,
    'peso_bruto', 10, 'humedad', 16.3, 'precio', 100, 'metodo', 'credito'));
  assert r.peso_neto = 9, format('10 × 83,7 / 93 = 9 (salió %s)', r.peso_neto);
  assert r.a_pagar = 0 and (select c.total - c.pagado from app.compra c join app.acopio a on a.compra_id = c.id where a.id = r.acopio_id) = 900, 'deuda';
end $$;

-- El cajero no da anticipos ni anula
do $$
begin
  perform pg_temp.cajero();
  begin
    perform app.dar_anticipo(pg_temp.id('juan'), 10);
    assert false, 'el cajero no da anticipos';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Anular devuelve stock, caja y anticipo
do $$
begin
  perform pg_temp.dueño();
  perform app.anular_acopio(pg_temp.id('acopio1'), 'Error de pesaje');
  assert (select stock from app.producto where id = pg_temp.id('cacao')) = 9, 'sale del inventario';
  assert (select saldo from app.anticipo where proveedor_id = pg_temp.id('juan')) = 50, 'el anticipo vuelve';
  assert (select estado from app.acopio where id = pg_temp.id('acopio1')) = 'anulado', 'anulado';
end $$;

-- ---------- Reporte por periodo ----------
do $$
declare
  p uuid; r record; rep jsonb; hoy date := (now() at time zone 'America/Guayaquil')::date;
begin
  perform pg_temp.dueño();
  insert into app.producto (negocio_id, nombre, unidad, precio, costo) values (app.negocio_actual(), 'Saco vacío', 'Unidad', 1.15, 0.5) returning id into p;
  perform app.mover_stock(p, 'inicial', 100, null, 'Inicial', 0.5);
  select * into r from app.registrar_venta(jsonb_build_array(jsonb_build_object('producto_id', p, 'cantidad', 10)),
    '[{"metodo":"efectivo","monto":11.5}]');
  select * into r from app.registrar_venta(jsonb_build_array(jsonb_build_object('producto_id', p, 'cantidad', 2)),
    '[{"metodo":"transferencia","monto":2.3}]');
  perform app.anular_venta(r.venta_id, 'Prueba');
  insert into app.gasto (negocio_id, categoria, monto, metodo) values (app.negocio_actual(), 'Transporte', 15, 'efectivo');

  rep := app.reporte_periodo(hoy - 6, hoy);
  assert (rep->>'ventas')::int = 1 and (rep->>'total')::numeric = 11.5, 'una venta vigente';
  assert (rep->>'anuladas')::int = 1, 'una anulada';
  assert (rep->>'costo')::numeric = 5, '10 × 0,50';
  assert (rep->>'base')::numeric = 10, 'sin IVA: 11,50 / 1,15';
  assert jsonb_array_length(rep->'por_dia') = 7, 'siete días, con ceros';
  assert (rep->'productos'->0->>'utilidad')::numeric = 5, 'utilidad por producto';
  assert rep->'por_metodo'->0->>'metodo' = 'efectivo', 'por método';
  assert rep->'vendedores'->0->>'vendedor' = 'Don Pedro', 'por vendedor';
  assert (rep->>'gastos')::numeric = 15, 'gastos del periodo';
  assert (rep->>'compras')::numeric = 900, 'solo la compra vigente';
  begin
    perform app.reporte_periodo(hoy, hoy - 1);
    assert false, 'fechas al revés';
  exception when invalid_parameter_value then null;
  end;
end $$;

rollback;
