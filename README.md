# Acceso y creación de cuentas · SAUL S.A.

Abre `index.html` en Chrome, Edge o Firefox actualizado. Funciona como proyecto local sin instalación, dependencias externas ni conexión a Internet.

## Recorrido

1. **Iniciar sesión:** usa la cuenta inicial `demo@saulbank.com` / `SaulDemo2026!`, o elige **Regístrate aquí**.
2. **Registro:** completa nombre, apellido, documento, teléfono, correo y contraseña con su confirmación. Usa únicamente datos ficticios.
3. **Confirmar correo:** ingresa el código de seis dígitos que aparece en el recuadro **Código de prueba**. Se puede escribir o pegar completo. No se envía ningún correo real.
4. **Ingresar con la cuenta creada:** al confirmar el OTP, vuelve al login con el correo completado. Ingresa la contraseña elegida para abrir la bienvenida.
5. **Recuperación:** pulsa **¿Olvidó su usuario o contraseña?**, elige qué recuperar e ingresa el correo registrado. Tras verificar un nuevo OTP, verás tu usuario (que es tu correo) o podrás establecer una nueva contraseña.

## Validaciones y comportamiento

- Todos los datos de registro son obligatorios. Correo válido, nombres de 2 a 70 caracteres, documento de 5 a 30 caracteres y teléfono con 7 a 15 dígitos.
- Documento: validación general de formato, sin comprobación oficial de identidad ni reglas de un país específico.
- Contraseña de 8 a 128 caracteres, con mayúsculas, minúsculas, un número y un carácter especial. Confirmación idéntica y requisitos reactivos.
- Rechazo de correo o documento duplicado. La cuenta no se guarda hasta verificar el OTP.
- OTP aleatorio de seis dígitos: vence a los 5 minutos, admite 5 intentos y se puede reenviar después de 60 segundos. Al reenviar, se reemplaza la verificación anterior. Volver o cancelar descarta la verificación pendiente.
- Recuperación solo para correos guardados en este navegador o para la cuenta inicial de demostración. No se muestra una contraseña existente: se establece una nueva tras el OTP.
- Autorización para cambiar la contraseña válida por 10 minutos y consumida al guardar. La contraseña nueva debe diferir de la anterior.
- Sesión por pestaña, con vencimiento a los 30 minutos y cierre de sesión. La bienvenida muestra el nombre de la cuenta.
- Biometría sigue siendo una opción informativa; requiere integrar un servicio compatible con passkeys/WebAuthn.

## Datos locales y alcance

Las cuentas ficticias se guardan en `localStorage` bajo `saulbank.demo.accounts.v2`, y la sesión en `sessionStorage` bajo `saulbank.demo.session.v1`. Las contraseñas registradas se derivan con PBKDF2/SHA-256 y sal aleatoria, sin guardar el texto original. Cambiar la contraseña de la cuenta inicial también se conserva localmente; su contraseña original deja de funcionar.

Si el navegador impide almacenar datos, se muestra un aviso y las cuentas funcionan en memoria hasta recargar. Las verificaciones OTP pendientes se descartan al recargar. Para empezar de cero, elimina los datos locales de esta página desde las herramientas del navegador.

**Esta es una demostración de los flujos, sin verificación real de correo ni autenticación de servidor.** Los datos y permisos del navegador se pueden modificar. Para producción se necesita un servidor que gestione usuarios, OTP, envío de correo, límites de intentos, sesiones y autorización de cada recurso. Los códigos de producción no deben mostrarse en pantalla ni validarse en JavaScript del cliente.

## Archivos

- `index.html`: login, registro, OTP, recuperación, cambio de contraseña y bienvenida.
- `styles.css`: estilos adaptados a móvil y computadora.
- `login.js`: navegación, validaciones y operaciones locales de demostración.
- `assets/logo.svg`: logo original proporcionado.
- `tests/auth.browser.js` y `tests/verify.ps1`: pruebas del recorrido completo en Chrome con perfil temporal aislado.

## Ejecutar las pruebas

En Windows con Chrome instalado en su ruta habitual:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests\verify.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests\verify.ps1 -Width 1280
```

El verificador usa Chrome sin interfaz, controla una pestaña mediante su conexión de depuración local, comprueba el recorrido y elimina el perfil temporal al terminar. No utiliza el perfil personal del navegador. Puede necesitar permiso de ejecución fuera del aislamiento.
