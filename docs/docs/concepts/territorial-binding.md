# Territorial Binding

Agents are bound to geographic jurisdictions through H3 hexagonal cells.

## H3 Geospatial Indexing

[H3](https://h3geo.org/) is Uber's hierarchical hexagonal grid system. GNS-AIP uses resolution 10 cells (~15m area). Each cell maps to a physical location and, by extension, to the legal jurisdiction governing that location.

## Why Hexagons?

Hexagons tile the sphere uniformly (unlike squares which distort at poles). They have consistent neighbor relationships and multiple resolution levels. H3 resolution 10 provides building-level precision without person-level tracking.

## Jurisdiction Mapping

```
H3 Cell "8a2a1072b59ffff"
    → Coordinates: 41.89°N, 12.49°E
    → City: Rome, Italy
    → Jurisdiction: EU (GDPR, EU AI Act, eIDAS 2.0)
```

An agent provisioned with EU cells cannot operate on US data without explicit territorial expansion (which costs 10 GNS tokens per new cell).

## Privacy

Raw GPS coordinates are never stored. All locations are quantized to H3 cells at provisioning time.
