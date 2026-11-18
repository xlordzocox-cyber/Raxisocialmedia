-- Prueba A/B 2026-11-18 (Vesper, 3 escenas): Luis votó Seedream 5.5 en las 3. FLUX-PuLID se veía caricaturizado
-- y no siguió las escenas. Se desactiva para que nadie gaste en él; "Comparar modelos" queda para probar otros modelos.
update public.raxi_provider_prices set enabled = false where model = 'wavespeed-ai/flux-pulid';
