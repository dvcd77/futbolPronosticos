# ⚽ Pronosticador Mundial 2026

Predictor estadístico para el Mundial 2026, corriendo completamente en el navegador.
Desplegable como sitio estático en Render (capa gratuita, siempre activo — sin spin-down).

## Modelos incluidos

| Modelo | Algoritmo |
|--------|-----------|
| Poisson + Dixon-Coles | Distribución bivariate con corrección para marcadores bajos |
| ELO | Ratings dinámicos K=40 (WC), K=30 (oficial), K=20 (amistoso) |
| Forma reciente | Últimos 12 partidos con decaimiento exponencial (λ=0.88) |
| xG aproximado | Goals ajustados por calidad del rival (proxy ELO) |
| ML Ligero | Feature-weighted regression (ELO 32%, ataque 24%, defensa 20%, forma 18%, goles 6%) |
| Ensemble | Promedio ponderado de lambdas + Monte Carlo 10K–50K |

## Mercados predichos
- 1X2 con desviación estándar
- Marcadores exactos (matriz heatmap 7×7)
- Over/Under 1.5 / 2.5 / 3.5
- Ambos anotan (BTTS)
- Resultado al descanso (HT 1X2)
- Disparos totales y a puerta (estimados)

## Despliegue en Render (gratuito)

### Desde GitHub
1. Sube este repo a GitHub
2. Render → New → Static Site → conecta el repo
3. Build Command: `npm install && npm run build`
4. Publish Directory: `dist`
5. Deploy

El `render.yaml` incluido configura todo automáticamente.

### Desarrollo local
```bash
npm install
npm run dev
```

## API Key
1. Regístrate en football-data.org (gratis)
2. En la app: ⚙️ Configuración → pega tu key → Guardar
3. Pulsa "Cargar datos del Mundial 2026"

Límite free tier: 10 req/min (la app gestiona esto con cola automática).
