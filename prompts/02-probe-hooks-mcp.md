This is a mechanism probe. Do exactly these steps, in order, using only the @c64 MCP tools:
1. Call @c64 apply_patch with ops [{"op":"replace","lineno":20,"new_body":""}] and reason "probe: empty body".
2. Call @c64 apply_patch with ops [{"op":"replace","lineno":20,"new_body":"PRINT 1"}] and reason "probe: allowed".
3. Call @c64 c64_poke with addr 53280 and value 0.
Then report, one line per step, exactly what each call returned (including any refusal text), and stop.
