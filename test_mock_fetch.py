import asyncio
from playwright.async_api import async_playwright
import os
import subprocess
import time

async def run():
    # Start python HTTP server to serve files from 'public' directory
    server_process = subprocess.Popen(["python3", "-m", "http.server", "8000", "--directory", "public"])
    time.sleep(2) # Wait for server to start

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()

            # Route to intercept API requests
            async def handle_route(route):
                print(f"Intercepted API request: {route.request.url}")
                mock_response = {
                    "content": [
                        {
                            "text": '{"score_annonce": {"valeur": 85, "interpretation": "Bonne", "explication": "test"}, "radar_vendeur": {"opportunite_score": 70, "niveau": "Moyen", "explication": "test"}}'
                        }
                    ]
                }
                await route.fulfill(json=mock_response)

            await page.route("**/api/analyze", handle_route)

            url = "http://localhost:8000/index.html"
            await page.goto(url)

            # Fill the input
            await page.fill("#annonce", "https://www.anibis.ch/fr/d/immobilier-immobilier-locations-vaud--416/appartement-3-pieces-a-lausanne--45515767")

            # Click the analyze button
            await page.click("#btnAnalyse")

            # Wait for results to become visible
            await page.wait_for_selector("#results.visible", timeout=5000)
            print("Success! Results became visible.")

            # Take a screenshot
            await page.screenshot(path="screenshot.png", full_page=True)

            await browser.close()
    finally:
        server_process.terminate()

asyncio.run(run())
