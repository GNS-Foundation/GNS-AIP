# Cadenas de Delegación

Una cadena de delegación es una secuencia de certificados firmados criptográficamente que vincula un agente AI a un principal humano.

```
Principal Humano ──[cert 1]──> Agente Desplegador ──[cert 2]──> Agente Worker
     profundidad: 0               profundidad: 1                profundidad: 2
```

Cada cadena debe terminar en una raíz humana. Cadenas sin raíz humana son inválidas — el agente opera en nivel SHADOW.
