; authored 2026 for this repo (MIT) — NOT from any magazine. The page as PRINTED: Gazette notation, :rem = the
; Gazette checksum of the INTENDED line (fixtures/authored/ossuary.intended.bas). Planted misprints (scripts/author-page.mjs):
;   line 890 printed as "DATA 5,3,5.8,9,7,9,3" — intended "DATA 5,3,5,8,9,7,9,3"
10 C=24:S=0  :rem 65
15 PRINT"{CLR}"  :rem 202
19 FORI=1TOC:READA:S=S+A:NEXT  :rem 135
20 IFS<>115THENPRINT"{DOWN}  THE BONES ARE WRONG.":END  :rem 98
30 PRINT"{2 DOWN}  ** THE OSSUARY **"  :rem 21
40 PRINT"{DOWN}  PRESS {RVS}RETURN{OFF} TO COUNT"  :rem 131
50 GETK$:IFK$=""THEN50  :rem 1
60 PRINT"{CLR}{DOWN}  ";C;"BONES, SUM";S  :rem 254
70 PRINT"{DOWN}  IT LIVES.":END  :rem 168
885 DATA 3,1,4,1,5,9,2,6  :rem 146
890 DATA 5,3,5.8,9,7,9,3  :rem 160
895 DATA 2,3,8,4,6,2,6,4  :rem 151
