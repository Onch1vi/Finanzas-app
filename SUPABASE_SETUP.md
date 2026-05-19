# Setup de Supabase (sync entre dispositivos)

Esta guía toma ~5 minutos. Al terminar tendrás login con email/contraseña y tus datos viajando entre PC y celular.

---

## 1) Crear el proyecto

1. Ve a https://supabase.com/dashboard/sign-up y crea cuenta (puedes usar GitHub).
2. **New Project**:
   - **Project name**: `finanzas-app` (o el que quieras)
   - **Database Password**: pon una segura y guárdala
   - **Region**: la más cercana a ti (ej. `South America (São Paulo)` o `US East`)
   - **Plan**: Free
3. Espera 1-2 min mientras se crea el proyecto.

---

## 2) Crear la tabla `user_data`

1. Menú izquierdo → **SQL Editor** → **New query**.
2. Pega esto y dale **Run**:

```sql
create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.user_data enable row level security;

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
   - **anon public** key (la que dice "anon" — *no* la "service_role")

---

## 4) Configurar las claves en Vercel

A partir de la migración a Vite, las claves se ponen como **variables de entorno** en Vercel (mucho más seguro que pegarlas en código).

1. Ve a https://vercel.com/dashboard → tu proyecto Finanzas.
2. **Settings** (arriba) → **Environment Variables** (menú izquierdo).
3. Añade dos variables:

| Name | Value | Environment |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://xxxxxxxxxxxx.supabase.co` (la URL del paso 3) | Production, Preview, Development |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGc...` (la anon key del paso 3) | Production, Preview, Development |

> ⚠️ **Importante**: el prefijo `VITE_` es obligatorio. Sin él, Vite no expone la variable al cliente.

4. **Save**.
5. Forzar un **redeploy**: pestaña **Deployments** → último deploy → **⋯** → **Redeploy** → confirma sin caché.

### Si despliegas en Netlify

Mismo flujo: **Site configuration** → **Environment variables** → añade las dos.

---

## 5) Activar email/password

En el dashboard de Supabase:
1. **Authentication** → **Providers** → **Email** ya viene activo.
2. **Authentication** → **URL Configuration** → en **Site URL** pon tu URL de Vercel.

### Saltarte la confirmación de email

Si quieres entrar de inmediato sin esperar correo:
1. **Authentication** → **Providers** → **Email** → desactiva **Confirm email** → **Save**.

---

## 6) Activar TOTP (2FA) — opcional pero recomendado

1. **Authentication** → **Sign In / Up** (o **MFA**) → activa **Time-based one-time password (TOTP)**.
2. En la app: **Ajustes → Seguridad de cuenta → 2FA**. Escaneas un QR con Google/Microsoft Authenticator y listo.

Detalles en `MFA_SETUP.md`.

---

## 7) Probar

1. Abre tu URL de Vercel **en ventana de incógnito**.
2. Verás la pantalla de login.
3. **Crear cuenta** → tu correo + contraseña (mínimo 8 chars, letras y números).
4. Ya dentro: configura tu balance, deudas, etc.
5. Abre la app en el celular → entra con el mismo correo → tus datos aparecen. ✨

---

## Qué pasa si no configuro Supabase

Si no defines las variables `VITE_SUPABASE_*`, la app sigue funcionando solo con `localStorage` (modo offline-only). No verás la pantalla de login.

---

## Costos

Tier gratis de Supabase:
- 500 MB de base de datos
- 50 000 usuarios activos al mes
- 2 GB de transferencia

Sobra para una app personal.

---

## Problemas comunes

- **"Failed to fetch" al iniciar sesión** → la URL del proyecto está mal o no se aplicó el redeploy. Verifica que `VITE_SUPABASE_URL` esté en Vercel y haz redeploy.
- **Email no llega** → revisa spam, o desactiva confirmación (paso 5).
- **"new row violates row-level security policy"** → vuelve a correr el SQL del paso 2.
- **Login no aparece, sigue mostrando el dashboard sin pedir cuenta** → las env vars no se aplicaron. Confirma que las variables empiezan con `VITE_` y que hiciste redeploy con caché limpia.
