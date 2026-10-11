*version 9.1 3570624012
u 21
V? 2
R? 3
@libraries
@analysis
.TRAN 1 0 0 0
+0 1ms
+1 0.5
.DC 1 0 0 0 1 1
+ 0 0 V1
+ 0 4 -10
+ 0 5 10
+ 0 6 1
@targets
@attributes
@translators
a 0 u 13 0 0 0 hln 100 PCBOARDS=PCB
@setup
unconnectedPins 0
@index
pageloc 1 0 1200
@status
n 0 26:10:11 12:00:00;1791700000 e
s 2832 26:10:11 12:00:00;1791700000 e
*page 1 0 970 720 iA
@ports
port 5 agnd 100 200 h
a 1 s 3 0 0 0 hcn 100 LABEL=0
port 6 agnd 220 200 h
a 1 s 3 0 0 0 hcn 100 LABEL=0
@parts
part 2 VDC 100 150 h
a 0 sp 0 0 22 37 hln 100 PART=VDC
a 0 a 0:13 0 0 0 hln 100 PKGREF=V1
a 1 ap 9 0 24 7 hcn 100 REFDES=V1
a 1 u 13 0 -11 18 hcn 100 DC=10V
part 3 r 120 110 h
a 0 sp 0 0 0 10 hlb 100 PART=r
a 0 s 0:13 0 0 0 hln 100 PKGTYPE=RC05
a 0 a 0:13 0 0 0 hln 100 PKGREF=R1
a 0 ap 9 0 15 0 hln 100 REFDES=R1
a 0 u 13 0 15 25 hln 100 VALUE=2k
part 4 r 220 150 d
a 0 sp 0 0 0 10 hlb 100 PART=r
a 0 ap 9 0 15 0 hln 100 REFDES=R2
a 0 u 13 0 15 25 hln 100 VALUE=3k
part 7 Q2N2222 400 400 h
a 0 ap 9 0 15 0 hln 100 REFDES=Q1
part 1 titleblk 1000 800 h
a 1 s 13 0 350 10 hcn 100 PAGESIZE=A
@conn
w 8
s 100 150 100 110 9
s 100 110 120 110 10
w 11
a 0 sr 0 0 0 0 hln 100 LABEL=OUT
s 160 110 220 110 12
w 13
s 220 150 220 200 14
w 15
s 100 190 100 200 16
@junction
@attributes
@graphics
