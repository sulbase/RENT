# Plantillas de correo de Supabase Auth

Supabase envía estos correos, no el Worker. Se pegan a mano en el dashboard: **Authentication → Emails → Templates**. Este directorio es la copia versionada; si cambias una plantilla en el dashboard, actualiza el archivo aquí.

| Plantilla en Supabase | Asunto | Archivo |
|---|---|---|
| Reset Password | `Restablece tu contraseña de RENT` | `reset-password.html` |
| Confirm signup | `Confirma tu cuenta de RENT` | `confirm-signup.html` |
| Change Email Address | `Confirma tu nuevo correo en RENT` | `change-email.html` |

- Variables de Supabase usadas: `{{ .ConfirmationURL }}`, `{{ .Email }}` y, en el cambio de correo, `{{ .NewEmail }}`.
- El destino del enlace sale de `VITE_AUTH_REDIRECT_URL` (`https://rent.sulbase.com/app`) y debe estar en **URL Configuration → Redirect URLs**.
- Remitente: en **SMTP Settings**, nombre `RENT · Sulbase` y una dirección del dominio verificado.
- HTML en tablas con estilos en línea para que Gmail y Outlook lo respeten. Probar enviando una recuperación a una cuenta propia después de pegarla.
