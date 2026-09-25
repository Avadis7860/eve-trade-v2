# Phase 4 — Trade Analysis

## Incrément 03 — fraîcheur requise pour l'exécutabilité

Cet incrément durcit la frontière entre donnée observable et analyse déclarable EXECUTABLE.

### Règle

Une analyse ne peut pas être EXECUTABLE lorsque la preuve nécessaire pour établir sa fraîcheur est absente ou invalide.

`FRESHNESS_METADATA_MISSING` est donc un motif bloquant classé `DATA_UNAVAILABLE`. Le moteur conserve la valeur économique éventuellement calculable, mais ne transforme jamais l'absence de timestamp ou de métadonnée de fraîcheur en preuve de validité actuelle.

La doctrine ESI reste de considérer les métadonnées de cache comme partie de la qualité de la donnée : `expires` indique quand une représentation mise à jour peut être disponible et `last-modified` indique la dernière mise à jour du cache. Voir [EVE Developers — Best Practices for ESI](https://developers.eveonline.com/docs/services/esi/best-practices/).

### Preuve de non-régression

Le test dédié vérifie qu'un snapshot de marché complet dont `observed_at` est absent ne peut pas ressortir `EXECUTABLE`.

Le test couvre également l'absence réelle de propriété runtime, car une donnée sérialisée/legacy peut être incomplète même si le contrat TypeScript la déclare présente.

La couverture inclut aussi une métadonnée d'expiration invalide côté Player et vérifie qu'un décalage temporel entre Market et Player reste acceptable lorsque chaque source respecte la policy déclarée.
## Incrément 02 — orchestration économique déterministe

Cet incrément verrouille l'orchestration du contrat Phase 4 sans introduire d'API, de persistence d'opportunité ou d'exécution réelle.

### Pipeline

```
TradeAnalysisRequest
  ↓
validation scénario / contraintes
  ↓
validation market / player / freshness
  ↓
simulation leg-by-leg
  ↓
capital / fees / logistics validation
  ↓
TradeAnalysisResult
```

### Scénarios supportés

Phase 4 peut maintenant analyser séparément :

```
TAKER_AGAINST_SELL
→ détention
→ TAKER_AGAINST_BUY
```

Ce chemin couvre notamment le cas réel où l'opération achète la liquidité vendeuse existante puis revend contre la liquidité acheteuse existante.

Le domaine ne déduit jamais l'intention économique à partir de l'identité d'un ordre. `order_id` reste une preuve d'ordre observé et un tie-break de simulation uniquement.

Une acquisition `EXISTING_INVENTORY` est aussi supportée. Dans ce cas, la quantité est une donnée explicitement déclarée par le scénario ; elle ne devient pas un coût historique implicite.

### Capital

Deux policies sont supportées :

- `EXPLICIT_DEPLOYABLE` : le capital déployable est fourni explicitement ;
- `WALLET_BALANCE` : le wallet complet et frais doit être fourni par Player Data.

`committed_escrow` reste distinct. Phase 4 ne calcule jamais silencieusement `wallet - escrow`.

Pour une acquisition de marché, le capital limite directement la quantité simulable. Une simulation peut donc être `PARTIAL` lorsque le capital autorise seulement une partie de la quantité demandée.

### Frais

Pour les deux modes taker supportés par cet incrément :

- le broker fee n'est pas appliqué comme coût automatique d'un ordre immédiat ;
- la sales tax reste due sur la disposition vendue et son taux doit être connu pour obtenir une économie nette complète.

Aucune valeur inconnue de frais n'est convertie en `0`.

La configuration `broker_fee_rate` reste conservée pour les extensions maker futures ; les modes maker ne sont pas exécutables dans cet incrément.

### Inventaire et cost basis

`EXISTING_INVENTORY` peut être utilisé sans inventer de coût historique.

- `cost_basis` fourni : il représente le coût historique total de la quantité du scénario ;
- `cost_basis` absent/null : le résultat historique complet reste inconnu.

Dans ce second cas, l'analyse peut produire la disposition et ses frais, mais ne fabrique ni `gross_result`, ni `simulated_net_result`, ni `simulated_return` à partir d'un coût nul.

### Logistique

Même lieu d'origine et de destination : aucune logistique de transport n'est requise et un coût de `0` est dérivé du fait qu'aucun déplacement n'est nécessaire.

Origine et destination différentes : un `LogisticsContext` `COMPLETE` avec coût explicite est requis pour qu'une analyse complète soit `EXECUTABLE`.

Aucun routeur, nombre de jumps ou temps de trajet n'est inventé.

### Freshness

`as_of` est la référence temporelle de l'analyse.

Le moteur vérifie :

- timestamp d'observation ;
- données futures par rapport à `as_of` ;
- âge maximum déclaré ;
- expiry ESI lorsqu'elle est fournie par Player Data.

Une ancienne donnée canonique ne devient jamais actuelle silencieusement.

### Market evidence / provenance

Le résultat conserve :

- snapshot d'acquisition ;
- snapshot de disposition ;
- `order_id` simulés ;
- provenance PUBLIC du marché.

Une liquidité de carnet n'est jamais transformée en propriétaire de l'ordre. Les observations CHARACTER de Player Data restent rattachées au personnage observé et ne deviennent pas de l'ownership de la liquidité publique.

### Économie simulée

Pour un round-trip complet :

```
gross_result
  = disposition_proceeds - acquisition_cash_outflow

fees_total
  = sales_tax on disposition

simulated_net_result
  = gross_result - fees_total - logistics_cost

simulated_return
  = simulated_net_result / capital_required
```

`simulated_return` n'est calculé que pour un capital strictement positif.

Les résultats Phase 4 restent explicitement simulés. Ils ne sont pas du `realized P&L`.

### États de sortie

`EXECUTABLE` exige une simulation complète et un résultat économique complet.

`PARTIAL` couvre notamment :

- profondeur insuffisante ;
- capital ne permettant qu'une fraction ;
- cost basis historique inconnu ;
- frais ou logistique manquants.

`STALE` couvre les données qui ne satisfont plus la freshness policy.

`DATA_UNAVAILABLE` couvre les market/player/capital inputs nécessaires mais indisponibles.

`NOT_EXECUTABLE` couvre les scénarios invalides, contraintes incompatibles ou modes maker non supportés.

### Ce qui reste hors périmètre

- placement/modification/annulation d'ordres ;
- exécution réelle ;
- persistence et tracking Phase 5 ;
- realized P&L ;
- prediction, scoring, recommendation ;
- API et UI ;
- corporation wallet / corporation orders ;
- stratégie maker garantie ;
- provider automatique de route.

## Incrément 01

Le premier incrément a verrouillé la simulation de carnet multi-level, le settlement distinct du book price, le tie-break déterministe, les ranges ESI et le fingerprint.
