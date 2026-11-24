# AIQA Website

The AIQA website, built with Eleventy (11ty).

## Structure

- `src/` - Source files (HTML templates)
  - `_layouts/` - Layout templates (base.html)
  - `_includes/` - Reusable includes (navbar.html, footer.html)
- `style/` - LESS stylesheets (compiled to CSS)
- `webroot/` - Generated HTML output (do not edit directly)

TODO let's copy webapp/public/common to website/webroot/common so that the website can reuse webapp images.

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

Both `build` and `dev` compile `style/main.less` to `webroot/style/main.css` with the local LESS compiler before running Eleventy. This happens at startup; rerun `npm run build:css` or restart `dev` after editing LESS files.

### Development Server

```bash
npm run dev
```

This will start a local server (usually at http://localhost:8080) and watch for changes.

## Pages

- `index.html` - Homepage
- `about.html` - About AIQA
- `docs.html` - Documentation and quick start guides
 
