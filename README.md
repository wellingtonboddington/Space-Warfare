# SEVERANCE

A hard-sci-fi cislunar combat game about trust between a human pilot and a shipboard AI that
are forbidden by law from touching each other's half of the ship.

**Play:** download `index.html` and open it in a modern browser (Microsoft Edge recommended for voices).
It is fully self-contained: no server, no network, no install.

**Develop:**
```bash
npm install
npm run dev        # http://localhost:8080/dev.html (rebuilds on reload)
npm test           # simulation / AI / grammar test suites (Node)
npm run batch      # headless AI-vs-AI encounter statistics
npm run build      # rebuild the self-contained index.html
npm run smoke      # Playwright file:// smoke test of every mode x variant
python3 blender/build_all.py   # rebuild every 3D asset headless (needs: pip install bpy==5.2.3)
```

**Docs:** `docs/WORLD_BIBLE.md` (canon), `docs/PASS1_SPEC.md` (verbatim design brief),
`docs/ARCHITECTURE.md`, `docs/AI_SYSTEMS.md`, `docs/COMMS_GRAMMAR.md`, `docs/ASSETS.md`, `docs/ROADMAP.md`.
