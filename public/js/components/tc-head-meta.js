/**
 * TCurl Head Meta Component
 * Injects shared <head> resources: favicon, Tailwind config, fonts, Material Symbols
 *
 * @element tc-head-meta
 * @example
 * <head>
 *   <meta charset="UTF-8">
 *   <meta name="viewport" content="width=device-width, initial-scale=1.0">
 *   <title>Page Title - TCurl</title>
 *   <script src="/js/components/tc-head-meta.js"></script>
 *   <tc-head-meta></tc-head-meta>
 * </head>
 */
class TCHeadMeta extends HTMLElement {
  connectedCallback() {
    this.#injectFavicon();
    this.#injectFonts();
    this.#injectTailwind();
    this.#injectMaterialSymbolsStyle();
  }

  #injectFavicon() {
    if (document.querySelector('link[rel="icon"]')) return;
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = '/favicon.svg';
    document.head.appendChild(link);
  }

  #injectFonts() {
    const preconnects = [
      { href: 'https://fonts.googleapis.com' },
      { href: 'https://fonts.gstatic.com', crossOrigin: '' },
    ];
    preconnects.forEach(({ href, crossOrigin }) => {
      if (document.querySelector(`link[href="${href}"][rel="preconnect"]`)) return;
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = href;
      if (crossOrigin !== undefined) link.crossOrigin = crossOrigin;
      document.head.appendChild(link);
    });

    const fontHref = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap';
    if (!document.querySelector(`link[href="${fontHref}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = fontHref;
      document.head.appendChild(link);
    }

    const iconHref = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined';
    if (!document.querySelector(`link[href^="${iconHref}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = iconHref;
      document.head.appendChild(link);
    }
  }

  #injectTailwind() {
    const twSrc = 'https://cdn.tailwindcss.com?plugins=forms,container-queries';
    if (!document.querySelector(`script[src="${twSrc}"]`)) {
      const script = document.createElement('script');
      script.src = twSrc;
      document.head.appendChild(script);
    }

    if (!document.querySelector('script[data-tc-tailwind-config]')) {
      const configScript = document.createElement('script');
      configScript.setAttribute('data-tc-tailwind-config', '');
      configScript.textContent = `
        if (typeof tailwind !== 'undefined') {
          tailwind.config = {
            darkMode: "class",
            theme: {
              extend: {
                colors: {
                  "primary": "#1337ec",
                  "background-light": "#f6f6f8",
                  "background-dark": "#101322",
                },
                fontFamily: {
                  "display": ["Space Grotesk", "sans-serif"]
                },
                borderRadius: {
                  "DEFAULT": "0.25rem",
                  "lg": "0.5rem",
                  "xl": "0.75rem",
                  "full": "9999px"
                },
              },
            },
          }
        }
      `;
      document.head.appendChild(configScript);
    }
  }

  #injectMaterialSymbolsStyle() {
    if (document.querySelector('style[data-tc-material-symbols]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-tc-material-symbols', '');
    style.textContent = `
      .material-symbols-outlined {
        font-variation-settings:
          'FILL' 0,
          'wght' 400,
          'GRAD' 0,
          'opsz' 24;
      }
    `;
    document.head.appendChild(style);
  }
}

customElements.define('tc-head-meta', TCHeadMeta);
