// Example decks for Netlist Mode (each is covered by tests/netlist-mode.test.ts).
export const NETLIST_EXAMPLES: { name: string; text: string }[] = [
  { name: 'Voltage divider (.OP)', text: `Voltage divider
* V(OUT) should be 6 V and the current 2 mA
V1 IN 0 DC 10
R1 IN OUT 2k
R2 OUT 0 3k
.OP
.END
` },
  { name: 'RC charging (.TRAN)', text: `RC charging, tau = 0.1 s
V1 IN 0 PULSE(0 10 0 1u 1u 10 20)
R1 IN OUT 1k
C1 OUT 0 100u
.TRAN 1ms 0.5s
.MEAS TRAN vtau FIND V(OUT) AT=0.1
.END
` },
  { name: 'RL transient with initial current', text: `Source-free RL: iL(0) = 1 A, tau = 0.1 s
L1 A 0 1H IC=1
R1 A 0 10
.TRAN 1ms 0.5s
.END
` },
  { name: 'Series RLC with capacitor IC', text: `Source-free series RLC (underdamped)
C1 A 0 0.04 IC=10
L1 A B 1 IC=0
R1 B 0 2
.TRAN 1ms 5s
.END
` },
  { name: 'DC sweep', text: `Divider DC sweep: Vout = 0.6 Vin
V1 IN 0 DC 0
R1 IN OUT 2k
R2 OUT 0 3k
.DC V1 -10 10 1
.END
` },
  { name: 'AC sweep (RC low-pass)', text: `RC low-pass, fc = 159.15 Hz
V1 IN 0 AC 1
R1 IN OUT 1k
C1 OUT 0 1u
.AC DEC 50 1 100k
.END
` },
  { name: 'Maximum power transfer (.DC PARAM)', text: `Maximum power transfer: P(RL) = VS^2 RL/(RS+RL)^2, max 0.5 W at RL = RS = 50
VS IN 0 DC 10
RS IN OUT 50
RL OUT 0 {RL}
.PARAM RL=50
.DC PARAM RL 5 200 5
.PROBE W(RL)
.END
` },
  { name: 'Parameter sweep (.STEP PARAM)', text: `Divider with stepped load resistor
.PARAM RL=3k
V1 IN 0 DC 10
R1 IN OUT 2k
R2 OUT 0 {RL}
.OP
.DC V1 0 10 1
.STEP PARAM RL LIST 1k 3k 9k
.END
` },
  { name: 'Time-controlled switch (S + PWL)', text: `Switch closes at 1 ms, charging C through R
* A voltage-controlled switch driven by a PWL control source acts as a timed switch
V1 IN 0 DC 10
S1 IN A CTL 0 SWMOD
VCTL CTL 0 PWL(0 0 1m 0 1.001m 1)
.MODEL SWMOD SW(Ron=0.01 Roff=1Meg Vt=0.5 Vh=0)
R1 A OUT 1k
C1 OUT 0 100u IC=0
.TRAN 10us 0.5s
.END
` },
];
