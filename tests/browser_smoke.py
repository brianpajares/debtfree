"""Run with python3 tests/browser_smoke.py (requires Playwright and Chromium)."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}'
errors = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url)
        expect(page.locator('#total-debt')).to_have_text('S/ 24,800')
        page.locator('[data-view="plan"]').first.click()
        page.locator('[data-strategy="bola"]').click()
        expect(page.locator('[data-strategy="bola"]')).to_have_attribute('aria-checked', 'true')
        page.locator('#extra-range').evaluate("e => {e.value='750';e.dispatchEvent(new Event('input',{bubbles:true}))}")
        expect(page.locator('#extra-value')).to_have_text('S/ 750')
        page.locator('[data-view="deudas"]').first.click()
        page.locator('#all-debt-list [data-edit]').first.click()
        page.locator('#debt-balance').fill('6400')
        page.locator('#debt-submit-button').click()
        expect(page.locator('#debt-page-total')).to_have_text('S/ 24,300')
        page.locator('[data-open-add]').first.click()
        for selector, value in [('#debt-name', 'Cuenta prueba'), ('#debt-balance', '8000'), ('#debt-apr', '18'), ('#debt-min', '120')]:
            page.locator(selector).fill(value)
        page.locator('#debt-kind').select_option(label='Personal')
        page.locator('#debt-submit-button').click()
        row = page.locator('#all-debt-list .debt-row').filter(has_text='Cuenta prueba')
        expect(row).to_be_visible()
        row.locator('[data-pay]').click()
        page.locator('#payment-amount').fill('500')
        page.locator('#payment-form button[type=submit]').click()
        expect(page.locator('#debt-page-total')).to_have_text('S/ 31,800')
        page.reload()
        expect(page.locator('#debt-page-total')).to_have_text('S/ 31,800')
        page.locator('[data-view="actividad"]').first.click()
        with page.expect_download() as download:
            page.locator('#activity-export').click()
        assert download.value.suggested_filename == 'mi-historial-deuda-cero.csv'

        def load_plan(balance, minimum, apr, view):
            data = {'extra': 0, 'strategy': 'avalancha', 'isSample': False, 'activity': [], 'debts': [
                {'id': 'custom', 'name': 'Mi deuda', 'kind': 'Personal', 'balance': balance, 'initialBalance': balance, 'minimum': minimum, 'apr': apr}]}
            page.evaluate("data => localStorage.setItem('deuda-cero.v1',JSON.stringify(data))", data)
            page.goto(url + '#' + view)
            page.reload()

        load_plan(10000, 1, 100, 'plan')
        expect(page.locator('#simulator-date')).to_have_text('Ajusta tu plan')
        expect(page.locator('#simulator-months')).to_have_text('Sin fecha estimada')
        load_plan(150, 150, 0, 'resumen')
        expect(page.locator('#chart-max')).to_have_text('S/ 150')
        expect(page.locator('#chart-mid')).to_have_text('S/ 75')
        assert len(page.locator('linearGradient').evaluate_all('(nodes) => nodes.map(n => n.id)')) == 2
        assert page.locator('linearGradient').evaluate_all('(nodes) => new Set(nodes.map(n=>n.id)).size') == 2

        mobile = browser.new_context(viewport={'width': 390, 'height': 844}).new_page()
        mobile.on('pageerror', lambda error: errors.append(str(error)))
        mobile.goto(url)
        for view in ['resumen', 'deudas', 'plan', 'actividad']:
            mobile.locator(f'[data-view="{view}"]').first.click()
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth'), view
        mobile.locator('[data-view="resumen"]').first.click()
        mobile.on('dialog', lambda dialog: dialog.accept())
        mobile.locator('[data-reset-demo]').click()
        mobile.locator('[data-view="deudas"]').first.click()
        expect(mobile.locator('#debt-empty')).to_be_visible()
        assert not errors, errors
        browser.close()
        print('PASS: complete desktop flow, persistence, CSV, unreachable payoff, small balances and four mobile views.')
finally:
    server.shutdown()
    server.server_close()
