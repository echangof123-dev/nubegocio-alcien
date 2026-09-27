-- Etapa 4: facturación electrónica (numeración, clave de acceso, estados, anulación con nota de crédito).
begin;

insert into auth.usuario (id, celular) values
  ('00000000-0000-0000-0000-0000000000f1', '+593990000061'),   -- dueño
  ('00000000-0000-0000-0000-0000000000f2', '+593990000062'),   -- cajera
  ('00000000-0000-0000-0000-0000000000f3', '+593990000063');   -- otro negocio

create temp table ids (clave text primary key, id uuid);
grant select, insert, update on ids to alcien_app;

insert into ids values ('tienda', app.crear_negocio('00000000-0000-0000-0000-0000000000f1', 'T045', 'Tienda F'));
insert into ids values ('otra', app.crear_negocio('00000000-0000-0000-0000-0000000000f3', 'T045', 'Otra F'));
insert into app.membresia (usuario_id, negocio_id, rol)
select '00000000-0000-0000-0000-0000000000f2', id, 'cajero' from ids where clave = 'tienda';

create function pg_temp.prod(n text) returns uuid language sql as $$ select id from app.producto where nombre = n $$;
create function pg_temp.dueño() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-0000000000f1', (select id from ids where clave = 'tienda'));
$$;
create function pg_temp.cajera() returns void language sql as $$
  select app.entrar_negocio('00000000-0000-0000-0000-0000000000f2', (select id from ids where clave = 'tienda'));
$$;
create function pg_temp.vender(p_producto text, p_cant numeric, p_monto numeric, p_cliente uuid default null,
                               p_comprobante text default 'factura')
returns uuid language sql as $$
  select venta_id from app.registrar_venta(
    jsonb_build_array(jsonb_build_object('producto_id', pg_temp.prod(p_producto), 'cantidad', p_cant)),
    jsonb_build_array(jsonb_build_object('metodo', 'efectivo', 'monto', p_monto)),
    p_cliente, p_comprobante);
$$;
grant execute on function pg_temp.prod(text), pg_temp.dueño(), pg_temp.cajera(),
  pg_temp.vender(text, numeric, numeric, uuid, text) to alcien_app;

select set_config('app.negocio_id', '', true);
set local role alcien_app;

-- ---------- Dígito verificador y clave de acceso ----------
do $$
declare
  c text;
begin
  -- 3·2 + 3·3 + 5·4 + 1·5 + 6·6 + 2·7 + 1·2 + 4·3 = 104 → 104 mod 11 = 5 → 11 − 5 = 6
  assert app.modulo11('41261533') = 6, 'módulo 11';
  assert app.modulo11('0') = 0, 'módulo 11 da 11 → 0';

  c := app.clave_acceso('2026-09-27', '01', '1790012345001', 1, '001', '002', 123, '12345678');
  assert length(c) = 49, 'la clave tiene 49 dígitos';
  assert left(c, 8) = '27092026', 'fecha ddmmaaaa';
  assert substr(c, 9, 2) = '01' and substr(c, 11, 13) = '1790012345001' and substr(c, 24, 1) = '1', 'tipo, RUC, ambiente';
  assert substr(c, 25, 6) = '001002' and substr(c, 31, 9) = '000000123', 'serie y secuencial';
  assert substr(c, 40, 8) = '12345678' and substr(c, 48, 1) = '1', 'código y tipo de emisión';
  assert right(c, 1)::int = app.modulo11(left(c, 48)), 'dígito verificador';
end $$;

-- ---------- Configuración ----------
do $$
begin
  perform pg_temp.dueño();
  update app.producto set precio = 1.35 where nombre = 'Arroz 1 kg';
  update app.producto set precio = 0.15 where nombre = 'Pan';
  perform app.abrir_caja(20);

  -- Sin configurar no se factura (y la venta entera se revierte)
  begin
    perform pg_temp.vender('Pan', 1, 0.15);
    perform app.sri_reservar((select id from app.venta order by creado_en desc limit 1), 'factura');
    assert false, 'sin configuración no se factura';
  exception when object_not_in_prerequisite_state then null;
  end;

  -- La cajera no configura la facturación
  perform pg_temp.cajera();
  begin
    perform app.sri_guardar_datos('{"ruc":"1790012345001","razon_social":"Tienda F S.A.","dir_matriz":"Quito","dir_establecimiento":"Quito"}');
    assert false, 'la cajera no configura';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.dueño();
  -- La firma se sube después de los datos
  begin
    perform app.sri_guardar_firma('\x00', '\x00', 'X', 'Y', '1', now() + interval '1 year');
    assert false, 'firma sin datos';
  exception when invalid_parameter_value then null;
  end;

  perform app.sri_guardar_datos('{"ruc":"1790012345001","razon_social":"Tienda F S.A.","nombre_comercial":"Tienda F",
    "dir_matriz":"Av. Amazonas N1, Quito","dir_establecimiento":"Av. Amazonas N1, Quito","estab":"001","pto_emi":"002",
    "regimen":"rimpe_emprendedor","siguiente_factura":"100"}');
  perform app.sri_guardar_firma('\xdeadbeef', '\xcafe', 'JUAN PEREZ', 'AC PRUEBA', '1234', now() + interval '1 year');
  assert (select ruc from app.sri_config) = '1790012345001', 'datos guardados';

  -- Bajar el número siguiente no retrocede la numeración
  perform app.sri_guardar_datos('{"ruc":"1790012345001","razon_social":"Tienda F S.A.","dir_matriz":"Quito",
    "dir_establecimiento":"Quito","estab":"001","pto_emi":"002","regimen":"rimpe_emprendedor","siguiente_factura":"5"}');
  assert (select valor from app.contador where clave = 'sri:1:01:001-002') = 99, 'la numeración nunca retrocede';
end $$;

-- ---------- Emitir ----------
do $$
declare
  v uuid;
  c app.comprobante%rowtype;
  cli uuid;
begin
  perform pg_temp.cajera();   -- la cajera sí factura

  v := pg_temp.vender('Arroz 1 kg', 2, 2.70);
  c := app.sri_reservar(v, 'factura');
  insert into ids values ('venta1', v), ('fac1', c.id);
  assert c.secuencial = 100 and c.numero = '001-002-000000100', format('continúa en 100 (salió %s)', c.numero);
  assert c.estado = 'por_firmar' and c.cod_doc = '01' and c.ambiente = 1, 'factura en pruebas por firmar';
  assert c.comprador->>'tipo_identificacion' = '07' and c.comprador->>'identificacion' = '9999999999999', 'consumidor final';
  assert c.total = 2.70, 'total de la venta';
  assert right(c.clave_acceso, 1)::int = app.modulo11(left(c.clave_acceso, 48)), 'clave válida';
  assert substr(c.clave_acceso, 11, 13) = '1790012345001' and substr(c.clave_acceso, 31, 9) = '000000100', 'clave con RUC y secuencial';
  assert c.fecha_emision = (now() at time zone 'America/Guayaquil')::date, 'fecha de Ecuador';

  -- Una venta no se factura dos veces
  begin
    perform app.sri_reservar(v, 'factura');
    assert false, 'doble factura';
  exception when invalid_parameter_value then null;
  end;

  -- Consumidor final hasta $50
  update app.producto set precio = 26 where nombre = 'Arroz 1 kg';
  begin
    perform pg_temp.vender('Arroz 1 kg', 2, 52);
    perform app.sri_reservar((select id from app.venta order by numero desc limit 1), 'factura');
    assert false, 'más de $50 sin identificación';
  exception when invalid_parameter_value then null;
  end;

  -- Con cédula sí
  insert into app.cliente (negocio_id, nombre, tipo_identificacion, identificacion, correo, direccion)
  values (app.negocio_actual(), 'María López', 'cedula', '1710034065', 'maria@example.com', 'Quito')
  returning id into cli;
  v := pg_temp.vender('Arroz 1 kg', 2, 52, cli);
  c := app.sri_reservar(v, 'factura');
  insert into ids values ('venta2', v), ('fac2', c.id);
  assert c.secuencial = 101, 'siguiente número';
  assert c.comprador->>'tipo_identificacion' = '05' and c.comprador->>'razon_social' = 'María López'
     and c.comprador->>'correo' = 'maria@example.com', 'comprador con cédula';

  -- Una venta con nota se puede facturar después
  v := pg_temp.vender('Pan', 1, 0.15, null, 'nota');
  c := app.sri_reservar(v, 'factura');
  assert (select comprobante from app.venta where id = v) = 'factura', 'la venta pasa a factura';
  insert into ids values ('fac3', c.id), ('venta3', v);

  perform app.sri_guardar_firmado((select id from ids where clave = 'fac1'), '<factura id="comprobante"/>');
  perform app.sri_guardar_firmado((select id from ids where clave = 'fac2'), '<factura id="comprobante"/>');
  perform app.sri_guardar_firmado((select id from ids where clave = 'fac3'), '<factura id="comprobante"/>');
  begin
    perform app.sri_guardar_firmado((select id from ids where clave = 'fac1'), '<x/>');
    assert false, 'no se firma dos veces';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;

-- ---------- Envío al SRI ----------
do $$
declare
  n int;
  c app.comprobante%rowtype;
begin
  perform pg_temp.dueño();

  select count(*) into n from app.sri_tomar_pendientes(10);
  assert n = 3, format('tres pendientes (salió %s)', n);
  -- Ya tomados: nadie más los toma mientras se envían
  select count(*) into n from app.sri_tomar_pendientes(10);
  assert n = 0, 'no se toman dos veces';

  -- fac1: recibido y luego autorizado
  perform app.sri_registrar_resultado((select id from ids where clave = 'fac1'), 'recibido');
  select * into c from app.comprobante where id = (select id from ids where clave = 'fac1');
  assert c.estado = 'recibido' and c.proximo_intento > now() and c.enviando_desde is null, 'recibido, se consulta luego';
  perform app.sri_registrar_resultado(c.id, 'autorizado', '[]', c.clave_acceso, now());
  assert (select estado from app.comprobante where id = c.id) = 'autorizado', 'autorizado';

  -- fac2: sin conexión, se reintenta
  perform app.sri_registrar_resultado((select id from ids where clave = 'fac2'), 'firmado',
    '[{"mensaje":"Sin conexión con el SRI"}]');
  assert (select estado from app.comprobante where id = (select id from ids where clave = 'fac2')) = 'firmado', 'sigue firmado';
  -- Reintentar ya: se puede tomar por id
  select count(*) into n from app.sri_tomar_pendientes(10, (select id from ids where clave = 'fac2'));
  assert n = 1, 'reintento inmediato';
  perform app.sri_registrar_resultado((select id from ids where clave = 'fac2'), 'recibido');

  -- fac3: devuelta → se vuelve a emitir con otro número
  perform app.sri_registrar_resultado((select id from ids where clave = 'fac3'), 'devuelto',
    '[{"identificador":"35","mensaje":"ARCHIVO NO CUMPLE ESTRUCTURA XML"}]');
  c := app.sri_reemitir((select id from ids where clave = 'fac3'));
  assert c.secuencial = 103 and c.estado = 'por_firmar', format('reemitida con 103 (salió %s)', c.secuencial);
  assert (select estado from app.comprobante where id = (select id from ids where clave = 'fac3')) = 'anulado', 'la devuelta queda anulada';
end $$;

-- ---------- Anular ventas facturadas ----------
do $$
declare
  nc app.comprobante%rowtype;
begin
  perform pg_temp.dueño();

  -- Autorizada a consumidor final → el SRI no permite anularla
  begin
    perform app.anular_venta((select id from ids where clave = 'venta1'), 'Cliente devolvió el arroz');
    assert false, 'consumidor final no se anula';
  exception when object_not_in_prerequisite_state then null;
  end;

  -- Autorizada a un cliente identificado → nota de crédito (en la prueba cambiamos el comprador)
  update app.comprobante set comprador = '{"tipo_identificacion":"05","identificacion":"1710034065","razon_social":"María López"}'
  where id = (select id from ids where clave = 'fac1');
  perform app.anular_venta((select id from ids where clave = 'venta1'), 'Cliente devolvió el arroz');
  select * into nc from app.comprobante where venta_id = (select id from ids where clave = 'venta1') and tipo = 'nota_credito';
  assert found, 'se reserva la nota de crédito';
  assert nc.cod_doc = '04' and nc.secuencial = 1 and nc.estado = 'por_firmar', 'nota de crédito 1 por firmar';
  assert nc.doc_modificado_id = (select id from ids where clave = 'fac1') and nc.total = 2.70, 'modifica la factura por el total';
  assert nc.motivo = 'Cliente devolvió el arroz', 'con el motivo';
  assert (select estado from app.venta where id = (select id from ids where clave = 'venta1')) = 'anulada', 'venta anulada';
  assert (select estado from app.comprobante where id = (select id from ids where clave = 'fac1')) = 'autorizado',
    'la factura sigue autorizada: la anula la nota de crédito';

  -- En proceso en el SRI → esperar
  begin
    perform app.anular_venta((select id from ids where clave = 'venta2'), 'Error');
    assert false, 'no se anula mientras el SRI procesa';
  exception when object_not_in_prerequisite_state then null;
  end;

  -- Firmada pero nunca enviada → se anula sin nota de crédito
  perform app.sri_guardar_firmado((select id from app.comprobante where secuencial = 103 and cod_doc = '01'), '<factura/>');
  perform app.anular_venta((select id from ids where clave = 'venta3'), 'Error de cobro');
  assert (select estado from app.comprobante where secuencial = 103 and cod_doc = '01') = 'anulado', 'factura no enviada anulada';
  assert not exists (select 1 from app.comprobante where venta_id = (select id from ids where clave = 'venta3') and tipo = 'nota_credito'),
    'sin nota de crédito';

  -- Si el SRI la autoriza igual (se estaba enviando), queda autorizada
  perform app.sri_registrar_resultado((select id from app.comprobante where secuencial = 103 and cod_doc = '01'), 'devuelto');
  assert (select estado from app.comprobante where secuencial = 103 and cod_doc = '01') = 'anulado', 'anulada no cambia con devuelto';

  -- La cajera no anula
  perform pg_temp.cajera();
  begin
    perform app.anular_venta((select id from ids where clave = 'venta2'), 'x');
    assert false, 'cajera no anula';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- Aislamiento y enlace público ----------
do $$
declare
  t text;
  r record;
begin
  perform app.entrar_negocio('00000000-0000-0000-0000-0000000000f3', (select id from ids where clave = 'otra'));
  assert (select count(*) from app.comprobante) = 0, 'otro negocio no ve comprobantes';
  assert (select count(*) from app.sri_config) = 0, 'ni la configuración';

  select token_publico into t from app.comprobante where id = (select id from ids where clave = 'fac1');
  assert t is null, 'ni el token (RLS)';

  -- El enlace público funciona sin sesión, solo con el token exacto
  perform set_config('app.negocio_id', '', true);
  perform pg_temp.dueño();
  select token_publico into t from app.comprobante where id = (select id from ids where clave = 'fac1');
  perform set_config('app.negocio_id', '', true);
  select * into r from app.sri_publico(t);
  assert r.numero = '001-002-000000100' and r.estado = 'autorizado' and r.regimen = 'rimpe_emprendedor', 'RIDE público';
  assert not exists (select 1 from app.sri_publico(left(t, 35) || 'x')), 'token equivocado';
  assert not exists (select 1 from app.sri_publico('')), 'token vacío';
end $$;

rollback;
