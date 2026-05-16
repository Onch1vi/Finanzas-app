# Setup de Supabase (sync entre dispositivos)

Esta guía toma ~5 minutos. Al terminar tendrás login con email/contraseña y tus datos viajando entre PC y celular.

---

## 1) Crear el proyecto

1. Ve a https://supabase.com/dashboard/sign-up y crea cuenta (puedes usar GitHub).
2. **New Project** → Organización personal:
   - **Project name**: `finanzas-app` (o el que quieras)
   - **Database Password**: pon una segura y guárdala (la necesitas si haces backup, no para el día a día)
   - **Region**: la más cercana a ti (ej. `South America (São Paulo)` o `US East`)
   - **Plan**: Free
3. Espera 1-2 min mientras se crea el proyecto.

---

## 2) Crear la tabla `user_data`

1. En el dashboard de Supabase: menú izquierdo → **SQL Editor** → **New query**.
2. Pega esto y dale **Run**:

```sql
-- Tabla única: cada usuario tiene una fila con todo su JSON
create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Activar Row Level Security: nadie ve datos de otro
alter table public.user_data enable row level security;

-- Política: cada usuario solo puede leer/escribir su propia fila
drop policy if exists "users see own data" on public.user_data;
create policy "users see own data"
  on public.user_data
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

3. Deberías ver "Success. No rows returned". Listo.

---

## 3) Copiar las claves del proyecto

1. Menú izquierdo → **Project Settings** (engranaje) → **API**.
2. Copia estos dos valores:
   - **Project URL** (ej. `https://xxxxxxxxxxxx.supabase.co`)
   - **anon public** key (la que dice "anon" — *no* la "service_role", esa nunca se publica)

> 💡 La `anon key` está diseñada para ir en el cliente público. Lo que protege tus datos es Row Level Security (la política del paso 2). Aunque alguien vea la key, no puede leer datos de otra cuenta.

---

## 4) Pegar las claves en `index.html`

Abre `index.html` y busca esta sección cerca del inicio (línea ~440):

```html
<script>
  window.SUPABASE_URL = 'PASTE_HERE_SUPABASE_URL';
  window.SUPABASE_ANON_KEY = 'PASTE_HERE_SUPABASE_ANON_KEY';
</script>
```

Reemplaza los dos `PASTE_HERE_...` por los valores del paso 3. Guarda.

**Si editas desde GitHub web:**
1. Ve al repo → `index.html` → ícono de lápiz (editar).
2. Ctrl+F y busca `PASTE_HERE_SUPABASE_URL`.
3. Reemplaza ambos valores.
4. Abajo: **Commit changes**.
5. Vercel redepliega solo en ~30 segundos.

---

## 5) Activar email/password (opcional pero recomendado)

En el dashboard de Supabase:
1. **Authentication** → **Providers**.
2. **Email** ya debería estar activo (por defecto).
3. **Authentication** → **URL Configuration** → en **Site URL** pon la URL de tu app en Vercel (ej. `https://finanzas-app-xxx.vercel.app`). Esto hace que los emails de confirmación apunten al sitio correcto.

### Si quieres saltarte la confirmación de email (para usarte solo tú)

1. **Authentication** → **Providers** → **Email** → desactiva **Confirm email** → **Save**.
2. Ahora puedes registrarte y entrar de inmediato sin esperar el correo.

---

## 6) Probar

1. Abre tu app en el navegador (PC).
2. Verás la pantalla de login.
3. **Crear cuenta** → tu correo + contraseña.
4. Ya dentro: configura tu balance, deudas, etc.
5. Abre la app en el celular → entra con el mismo correo → verás tus datos. ✨

---

## Qué pasa si todavía no configuro Supabase

La app **sigue funcionando** sin Supabase. Si dejas los placeholders `PASTE_HERE_...`, la app detecta que no está configurado y guarda solo en `localStorage` del dispositivo actual. No verás la pantalla de login.

Esto te permite desplegar primero y configurar Supabase cuando quieras.

---

## Costos

Tier gratis de Supabase incluye:
- 500 MB de base de datos
- 50,000 usuarios activos al mes
- 2 GB de transferencia

Para una app personal: gratis por años.

---

## Problemas comunes

- **"Failed to fetch"** al iniciar sesión → la URL del proyecto está mal escrita. Revisa que termine en `.supabase.co` sin barra al final.
- **Email no llega** → revisa spam, o desactiva confirmación (paso 5).
- **"new row violates row-level security policy"** → la política RLS del paso 2 no se aplicó. Vuelve a correr ese SQL.
- **Veo los datos del otro usuario** → imposible si RLS está activo. Si pasara, hay un error en la política — verifica `Authentication → Policies` en el dashboard.
