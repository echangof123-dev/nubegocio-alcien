-- Tanda 1 de módulos: compras, proveedores, lotes y cotizaciones.
begin;

insert into auth.usuario (id, celular) values
  ('00000000-0000-0000-0000-0000000000a1', '+593990000071'),   -- dueña de una farmacia
  ('00000000-0000-0000-0000-0000000000a2', '+593990000072');   -- cajero

create temp table ids (clave text primary key, id uuid);
grant select, insert, update on ids to alcien_app;
insert into ids values ('farmacia', app.crear_negocio('00000000-0000-0000-0000-0000000000a1', 'T045', 'Tienda A'));
insert into app.membresia (usuario_id, negocio_id, rol)
select '00000000-0000-0000-0000-0000000000a2', id, 'cajero' from ids where clave = 'farmacia';

create function pg_temp.prod(n text) returns uuid language sql as $$ select id from app.producto where nombre = n $$;
create function pg_temp.dueña() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-0000000000a1', (select id from ids where clave = 'farmacia'));
$$;
create function pg_temp.cajero() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-0000000000a2', (select id from ids where clave = 'farmacia'));
$$;
grant execute on function pg_temp.prod(text), pg_temp.dueña(), pg_temp.cajero() to alcien_app;

select set_config('app.negocio_id', '', true);
set local role alcien_app;

-- ---------- Módulos ----------
do $$
declare
  r record;
begin
  perform pg_temp.dueña();
  select count(*) as n, count(*) filter (where estado = 'activo') as activos,
         count(*) filter (where en_familia) as familia
  into r from app.modulos_catalogo();
  assert r.n = 26, 'los 26 módulos aparecen';
  assert r.activos >= 10, format('la tienda trae sus módulos activos (%s)', r.activos);
  assert (select estado from app.modulos_catalogo() where modulo = 'M15') = 'activo', 'compras activo en tienda';
  assert (select estado from app.modulos_catalogo() where modulo = 'M24') = 'disponible', 'cotizaciones disponible';
  assert not (select en_familia from app.modulos_catalogo() where modulo = 'M24'), 'cotizaciones no es de su familia';

  -- Sin activar cotizaciones no se cotiza
  begin
    perform app.guardar_cotizacion(null, jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Arroz 1 kg'), 'cantidad', 1)));
    assert false, 'módulo inactivo';
  exception when insufficient_privilege then null;
  end;
  perform app.activar_modulo('M24');
  assert (select estado from app.modulos_catalogo() where modulo = 'M24') = 'activo', 'cotizaciones activado';
end $$;

-- ---------- Compras ----------
do $$
declare
  c uuid;
  r record;
begin
  perform pg_temp.dueña();
  update app.producto set precio = 1.35, costo = 1.00 where nombre = 'Arroz 1 kg';
  perform app.ajustar_stock(pg_temp.prod('Arroz 1 kg'), 10, 'Conteo');
  perform app.abrir_caja(50);

  insert into app.proveedor (negocio_id, nombre, ruc) values (app.negocio_actual(), 'Distribuidora Andina', '1790012345001')
  returning id into c;
  insert into ids values ('proveedor', c);

  -- 10 sacos más a 1,20 → stock 20, costo promedio (10·1,00 + 10·1,20) / 20 = 1,10
  c := app.registrar_compra((select id from ids where clave = 'proveedor'),
    jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Arroz 1 kg'), 'cantidad', 10, 'costo', 1.20,
                                         'lote', 'L-77', 'vence', (current_date + 20)::text)),
    'efectivo', 'FAC 001-001-123');
  insert into ids values ('compra1', c);
  select * into r from app.compra where id = c;
  assert r.total = 12.00 and r.pagado = 12.00 and r.numero = 1, format('compra de $12 pagada (%s)', r.total);
  assert (select stock from app.producto where nombre = 'Arroz 1 kg') = 20, 'el stock sube';
  assert (select costo from app.producto where nombre = 'Arroz 1 kg') = 1.10, 'costo promedio';
  assert (select efectivo_esperado from app.resumen_caja()) = 38, 'el efectivo sale de la caja';
  assert (select count(*) from app.lote where vence = current_date + 20 and cantidad = 10) = 1, 'lote registrado';

  -- A crédito: queda por pagar
  c := app.registrar_compra((select id from ids where clave = 'proveedor'),
    jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Arroz 1 kg'), 'cantidad', 5, 'costo', 1.10)), 'credito');
  insert into ids values ('compra2', c);
  assert (select total - pagado from app.compra where id = c) = 5.50, 'debe 5,50';
  assert app.pagar_compra(c, 2.50, 'transferencia') = 3.00, 'abono al proveedor';
  begin
    perform app.pagar_compra(c, 10, 'efectivo');
    assert false, 'no se paga de más';
  exception when invalid_parameter_value then null;
  end;

  -- Anular devuelve stock y el efectivo a la caja
  perform app.anular_compra((select id from ids where clave = 'compra1'), 'Mercadería equivocada');
  assert (select stock from app.producto where nombre = 'Arroz 1 kg') = 15, 'el stock baja al anular';
  assert (select efectivo_esperado from app.resumen_caja()) = 50, 'el efectivo vuelve';
  assert (select estado from app.lote where compra_id = (select id from ids where clave = 'compra1')) = 'retirado', 'lote retirado';
end $$;

-- El cajero no compra ni anula
do $$
begin
  perform pg_temp.cajero();
  begin
    perform app.registrar_compra(null, jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Arroz 1 kg'), 'cantidad', 1, 'costo', 1)), 'efectivo');
    assert false, 'cajero no compra';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- Lotes ----------
do $$
declare
  c uuid;
begin
  perform pg_temp.dueña();
  c := app.registrar_compra(null,
    jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod('Leche 1 L'), 'cantidad', 6, 'costo', 0.80, 'vence', (current_date - 1)::text)),
    'transferencia');
  perform app.cerrar_lote((select id from app.lote where compra_id = c), 'retirado', true);
  assert (select stock from app.producto where nombre = 'Leche 1 L') = 0, 'lo vencido sale del stock';
end $$;

-- ---------- Cotizaciones ----------
do $$
declare
  q uuid;
  v record;
  cli uuid;
begin
  perform pg_temp.dueña();
  insert into app.cliente (negocio_id, nombre) values (app.negocio_actual(), 'Constructora Sol') returning id into cli;
  q := app.guardar_cotizacion(cli, jsonb_build_array(
    jsonb_build_object('producto_id', pg_temp.prod('Arroz 1 kg'), 'cantidad', 4, 'descuento', 0.40)), 10, 'Precio especial');
  assert (select total from app.cotizacion where id = q) = 5.00, 'cotización 4 × 1,35 − 0,40 = 5,00';
  assert (select valida_hasta from app.cotizacion where id = q) = (now() at time zone 'America/Guayaquil')::date + 10, 'validez';
  assert (app.cotizacion_publica((select token_publico from app.cotizacion where id = q))->>'cliente') = 'Constructora Sol', 'enlace público';

  select * into v from app.convertir_cotizacion(q, '[{"metodo":"efectivo","monto":5.00}]');
  assert v.total = 5.00, 'la venta respeta el precio cotizado';
  assert (select estado from app.cotizacion where id = q) = 'aceptada', 'cotización aceptada';
  assert (select cliente_id from app.venta where id = v.venta_id) = cli, 'venta al cliente';
  begin
    perform * from app.convertir_cotizacion(q, '[{"metodo":"efectivo","monto":5.00}]');
    assert false, 'no se convierte dos veces';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;

rollback;
