/* Configuración PÚBLICA de NovaDesk por entorno. Las claves "publishable" están pensadas para ir en el navegador (la protección real
   son las políticas RLS de la base). NUNCA pongas aquí una clave "secret"/service_role.

   El MISMO código corre en los tres entornos; cada uno se reconoce por la dirección en la que está publicado:
     · DEV         → localhost (tu carpeta del escritorio). Usa una base SIMULADA en el navegador (dev/backend.js): no toca ningún Supabase.
     · QA          → https://benjamin0720.github.io/NovaDesk-QA/   → Supabase de QA
     · PRODUCCIÓN  → https://benjamin0720.github.io/NovaDesk-Prod/ → Supabase de Producción
   Una dirección que no esté en la lista NO recibe configuración (no se conecta a nada): así una copia o un fork jamás toca Producción.
   Flujo obligatorio: DEV → QA → PRODUCCIÓN (ver docs/entornos.md y scripts/flujo.ps1). */
(() => {
  const ENTORNOS = {
    // Supabase de pruebas: nunca apuntes aquí al de Producción. La URL y la clave de QA se completan al crear su proyecto (docs/entornos.md).
    dev: { nombre: 'DEV', url: 'https://dev-simulado.supabase.co', key: 'dev-simulado' },
    qa: { nombre: 'QA', url: 'https://ayfqjsjusfpjvlhoqozp.supabase.co', key: 'sb_publishable_1WBeFmVV1bDQY5d2i1F76w_kNGMyep3' },
    produccion: { nombre: 'Producción', url: 'https://mrlqgnqrqikwpeuzpmob.supabase.co', key: 'sb_publishable_x4uV7VV-RnANJP8B4dYTiQ_fj6N3_Zs' },
  };
  const SITIOS = [   // dónde está publicado cada entorno: dominio + carpeta (en GitHub Pages es el nombre del repositorio)
    { host: 'benjamin0720.github.io', carpeta: 'novadesk-prod', entorno: 'produccion' },
    { host: 'benjamin0720.github.io', carpeta: 'novadesk', entorno: 'produccion' },   // nombre anterior del repositorio de Producción: quitar cuando ya no se use
    { host: 'benjamin0720.github.io', carpeta: 'novadesk-qa', entorno: 'qa' },
  ];
  /* Devuelve 'dev' | 'qa' | 'produccion' | null (null = dirección desconocida: sin configuración). */
  function entornoDe(host, ruta) {
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) return 'dev';
    const carpeta = String(ruta).split('/')[1] || '';
    const s = SITIOS.find(x => x.host === String(host).toLowerCase() && x.carpeta === carpeta.toLowerCase());
    return s ? s.entorno : null;
  }
  const env = entornoDe(location.hostname, location.pathname), cfg = env && ENTORNOS[env];
  const lista = cfg && /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.url) && cfg.key !== 'PENDIENTE';
  window.NOVADESK_ENV = env;
  window.NOVADESK_CONFIG = lista ? { url: cfg.url, key: cfg.key, env } : {};
  window.NOVADESK_ENTORNO_DE = entornoDe;   // solo para probar la elección de entorno
  if (!lista) console.error(env ? `NovaDesk: el entorno ${cfg.nombre} aún no tiene Supabase configurado (js/config.js).` : 'NovaDesk: esta dirección no está registrada en js/config.js; no se conecta a ningún Supabase.');

  /* Avisos visibles: fuera de Producción siempre se ve en qué entorno estás (DEV ya tiene su propio panel). */
  addEventListener('DOMContentLoaded', () => {
    if (env === 'produccion') return;
    document.title = `[${cfg ? cfg.nombre : '?'}] ${document.title}`;
    if (env === 'dev') return;
    const b = document.createElement('div');
    b.textContent = !env ? '⚠️ Dirección no registrada: sin conexión a ninguna base' : lista ? '🧪 QA · datos de prueba (no es Producción)' : '🧪 QA · falta configurar su Supabase (docs/entornos.md)';
    b.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:9999;background:#ffb84d;color:#1a1200;font:600 12px/1 system-ui,sans-serif;padding:5px 14px;border-radius:0 0 10px 10px;box-shadow:0 2px 10px #0006;pointer-events:none';
    document.body.appendChild(b);
  });
})();
