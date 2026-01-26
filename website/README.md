# AIQA Website

The AIQA website, built with Eleventy (11ty).

## Structure

- `src/` - Source files (HTML templates)
  - `_layouts/` - Layout templates (base.html)
  - `_includes/` - Reusable includes (navbar.html, footer.html)
- `style/` - LESS stylesheets (compiled to CSS)
- `webroot/` - Generated HTML output (do not edit directly)

## Development

The site uses Eleventy to convert HTML templates in `src/` to HTML in `webroot/`.

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

### Development Server

```bash
npm run dev
```

This will start a local server (usually at http://localhost:8080) and watch for changes.

## Pages

- `index.html` - Homepage
- `about.html` - About AIQA
- `docs.html` - Documentation and quick start guides
