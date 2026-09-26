-- 0006 · Búsqueda de tipos de negocio y tipos nuevos propuestos por IA

-- Busca por nombre y sinónimos, sin tildes y tolerando errores de escritura.
-- "tienda de bario", "cevicheria", "vendo insumos agricolas" encuentran su tipo.
create or replace function catalogo.buscar_tipos(p_texto text, p_limite integer default 5)
returns table (
  codigo          text,
  nombre          text,
  familia         text,
  familia_nombre  text,
  puntaje         real
)
language sql
stable
as $$
  with crudo as (
    select catalogo.normalizar(trim(p_texto)) as t
  ),
  q as (
    -- Quita palabras de relleno ("vendo", "tengo una", "mi negocio de"...) para quedarse con lo que describe el negocio.
    select coalesce(
             nullif(trim(regexp_replace(
               regexp_replace(crudo.t,
                 '\m(vendo|vende|vendemos|venta|ventas|tengo|tenemos|soy|somos|un|una|unos|unas|mi|mis|el|la|los|las|de|del|y|en|para|con|negocio|local|al|por|mayor|menor)\M',
                 ' ', 'g'),
               '\s+', ' ', 'g')), ''),
             crudo.t) as t
    from crudo
  ),
  candidatos as (
    select
      tn.codigo,
      tn.nombre,
      tn.familia,
      f.nombre as familia_nombre,
      (
        greatest(
          word_similarity(q.t, tn.busqueda),
          similarity(q.t, catalogo.normalizar(tn.nombre))
        )
        + case when catalogo.normalizar(tn.nombre) like q.t || '%' then 0.30 else 0 end
        + case when tn.busqueda like '%' || q.t || '%' then 0.15 else 0 end
        + case when exists (select 1 from unnest(tn.sinonimos) s where catalogo.normalizar(s) = q.t)
               then 0.35 else 0 end
        + tn.prioridad * 0.04
      )::real as puntaje,
      tn.prioridad
    from catalogo.tipo_negocio tn
    join catalogo.familia f on f.codigo = tn.familia
    cross join q
    where tn.estado = 'aprobado'
      and length(q.t) >= 2
  )
  select codigo, nombre, familia, familia_nombre, puntaje
  from candidatos
  where puntaje - prioridad * 0.04 >= 0.35
  order by puntaje desc, prioridad desc, length(nombre), nombre
  limit greatest(1, least(coalesce(p_limite, 5), 20));
$$;

grant execute on function catalogo.buscar_tipos(text, integer) to alcien_app;


-- Tipo de negocio propuesto por la IA cuando nadie encontró el suyo.
-- Queda "pendiente": sirve de inmediato para ese negocio, pero no aparece en la
-- búsqueda de otros hasta que Nubegocio lo apruebe.
create sequence catalogo.tipo_ia_seq;

create or replace function catalogo.registrar_tipo_ia(
  p_nombre      text,
  p_familia     text,
  p_sinonimos   text[],
  p_categorias  text[],
  p_productos   jsonb     -- [{"categoria": "...", "nombre": "...", "unidad": "..."}]
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, catalogo
as $$
declare
  v_codigo text;
  v_id     bigint;
  v_existe text;
begin
  if p_nombre is null or length(trim(p_nombre)) < 3 or length(trim(p_nombre)) > 80 then
    raise exception 'Nombre de tipo inválido' using errcode = '22023';
  end if;
  if not exists (select 1 from catalogo.familia where codigo = p_familia) then
    raise exception 'Familia desconocida: %', p_familia using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_productos, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_productos, '[]'::jsonb)) > 30 then
    raise exception 'Lista de productos inválida' using errcode = '22023';
  end if;

  -- Si ya existe un tipo con ese nombre, se reutiliza.
  select codigo into v_existe from catalogo.tipo_negocio
  where catalogo.normalizar(nombre) = catalogo.normalizar(trim(p_nombre)) and estado <> 'rechazado';
  if v_existe is not null then
    return v_existe;
  end if;

  v_codigo := 'IA' || lpad(nextval('catalogo.tipo_ia_seq')::text, 4, '0');

  insert into catalogo.tipo_negocio (codigo, nombre, familia, sinonimos, categorias, estado, origen)
  values (v_codigo, trim(p_nombre), p_familia,
          coalesce(p_sinonimos[1:10], '{}'), coalesce(p_categorias[1:12], '{}'),
          'pendiente', 'ia')
  returning id into v_id;

  insert into catalogo.plantilla_producto (tipo_negocio_id, categoria, nombre, unidad, orden)
  select v_id,
         left(trim(p->>'categoria'), 60),
         left(trim(p->>'nombre'), 80),
         coalesce(nullif(left(trim(p->>'unidad'), 30), ''), 'Unidad'),
         (row_number() over ())::smallint
  from jsonb_array_elements(coalesce(p_productos, '[]'::jsonb)) p
  where coalesce(trim(p->>'nombre'), '') <> '' and coalesce(trim(p->>'categoria'), '') <> ''
  on conflict (tipo_negocio_id, nombre) do nothing;

  return v_codigo;
end $$;

revoke all on function catalogo.registrar_tipo_ia(text, text, text[], text[], jsonb) from public;
grant execute on function catalogo.registrar_tipo_ia(text, text, text[], text[], jsonb) to alcien_app;
