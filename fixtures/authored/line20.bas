; authored 2026 for this repo (MIT) — NOT from any magazine. The page as PRINTED: Gazette notation, :rem = the
; Gazette checksum of the INTENDED program; line 20 carries a planted misprint (PRIMT; tesseract.js 7 psm 6 read a printed PR1NT as PRINT, so that misprint never reached the C64 — measured 2026-11-25), so the page itself
; disagrees with its own checksum and the C64 says ?SYNTAX  ERROR IN 20.
10 PRINT"{CLR}{2 DOWN}"  :rem 231
20 PRIMT"   ** THE LAST SEANCE **"  :rem 159
30 PRINT"{DOWN}  A TYPE-IN FROM 2026"  :rem 138
40 PRINT"{2 DOWN}  KNOCK ONCE: PRESS {RVS}RETURN{OFF}"  :rem 61
50 GETK$:IFK$=""THEN50  :rem 1
60 IFK$<>CHR$(13)THEN50  :rem 40
70 PRINT"{CLR}{RVS} THE SPIRITS ANSWER {OFF}{DOWN}"  :rem 95
80 FORI=1TO5:READN$:PRINT"  ";N$:NEXT  :rem 215
90 PRINT"{DOWN}  READY TO RISE."  :rem 196
100 END  :rem 104
110 DATA "THE PAGE","THE CHECKSUM","THE MACHINE"  :rem 216
120 DATA "THE AGENT","IT LIVES"  :rem 209
