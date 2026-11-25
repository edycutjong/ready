; authored 2026 for this repo (MIT) — NOT from any magazine. The page as PRINTED: Gazette notation, :rem = the
; Gazette checksum of the INTENDED line (fixtures/authored/knock.intended.bas). Planted misprints (scripts/author-page.mjs):
;   line 80 printed as "DATA 73,84,32,78" — intended "DATA 73,84,32,76"
10 PRINT"{CLR}{2 DOWN}  ** THE NINTH KNOCK **"  :rem 103
20 PRINT"{DOWN}  A TYPE-IN FROM 2026"  :rem 137
30 PRINT"{2 DOWN}  PRESS {RVS}RETURN{OFF} TO LISTEN"  :rem 217
40 GETK$:IFK$=""THEN40  :rem 255
50 PRINT"{CLR}{DOWN}  THE WALL SAYS: ";  :rem 160
60 FORI=1TO8:READC:PRINTCHR$(C);:NEXT  :rem 136
70 PRINT:END  :rem 5
80 DATA 73,84,32,78  :rem 174
90 DATA 73,86,69,83  :rem 185
