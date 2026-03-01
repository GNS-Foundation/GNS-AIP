# Delegación

Los certificados de delegación crean una cadena criptográfica desde el principal humano hasta el agente AI.

## Cómo Funciona

Un **DelegationCert** es un certificado firmado que dice: "Yo, humano `X`, autorizo al agente `Y` a realizar acciones `Z` en el territorio `T` hasta el tiempo `E`."

## Alcance

Cada delegación tiene un **alcance** que limita lo que el agente puede hacer. Usa `"*"` para comodín (todas las acciones/recursos).

## Verificación de Cadena

Las cadenas de delegación pueden recorrerse programáticamente. `DelegationChain.verify()` recorre la cadena desde el agente hasta la raíz, verificando que cada certificado sea válido y que la raíz sea una identidad humana.

## Estrechamiento del Alcance

Cada delegación solo puede estrechar el alcance, nunca ampliarlo.
