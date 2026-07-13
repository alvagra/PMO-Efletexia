name: Reporte PMO Entregables

on:
  schedule:
    - cron: '0 21 * * 1'   # Lunes 8:00 PM Perú (UTC-5 = 21:00 UTC)
    - cron: '0 23 * * 5'   # Viernes 6:00 PM Perú
  workflow_dispatch:        # Permite ejecución manual desde GitHub

jobs:
  send-report:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Enviar reporte de entregables
        run: |
          curl -s -o response.json -w "%{http_code}" \
            -X POST https://pmo-efletexia.vercel.app/api/send-report \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
          cat response.json
