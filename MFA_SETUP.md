# Activar 2FA (autenticación en 2 pasos)

La app soporta 2FA con apps authenticator (Google Authenticator, Microsoft Authenticator, Authy). Para activarla en tu cuenta:

## Paso 1 — Activar MFA en Supabase

Solo necesitas hacer esto **una vez** en tu proyecto de Supabase:

1. Ve a https://supabase.com/dashboard → tu proyecto.
2. **Authentication** → **Sign In / Up** → **Auth Providers** o **MFA**.
3. Activa **Time-based one-time password (TOTP)**.
4. Guarda.

## Paso 2 — Activar 2FA en tu cuenta personal

Una vez que está habilitada a nivel del proyecto, cada usuario la activa por su cuenta:

1. Abre la app y entra con tu correo + contraseña.
2. **Ajustes** → **Seguridad de cuenta** → **Autenticación en 2 pasos (2FA)**.
3. Toca **Activar 2FA**.
4. Te aparece un **código QR**. Abre tu app authenticator:
   - **iOS/Android**: Google Authenticator, Microsoft Authenticator, Authy
   - **PC**: 1Password, Bitwarden (también guardan TOTP)
5. En tu app authenticator, dale **+ → Escanear código QR** y enfoca el QR.
6. Tu authenticator empieza a mostrar un código de 6 dígitos que cambia cada 30 segundos.
7. **Escribe el código actual** en el campo de la app y dale **Activar**.

Listo. La próxima vez que inicies sesión, la app te va a pedir ese código además de tu contraseña.

## Si pierdes acceso a tu authenticator

Si cambias de teléfono o se borra la app authenticator **sin** haber pasado primero la cuenta al nuevo:

1. Necesitas acceso a tu correo registrado.
2. Contacta a Supabase support si no puedes recuperar la cuenta.
3. **Recomendación**: guarda el "código manual" (cadena alfanumérica) que se muestra en el paso de activación — con eso puedes re-configurar el authenticator en otro dispositivo.

## Si quieres desactivar 2FA

**Ajustes** → **Seguridad de cuenta** → **2FA activa** → **Quitar**.
