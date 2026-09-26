# PHASE-08.3R — Étude comparative des méthodes de reconstruction économique

## Statut

Étude de conception réalisée depuis `main@836d478268ac17c255ff9f2b413d93ea7b0f5d3a`.

Cette branche est volontairement **research-first** :
- aucune logique métier runtime n'est ajoutée dans cette étape ;
- les branches `phase-08.3/economic-operation` et `phase-08.3/economic-operation-suite` restent du matériau d'audit ;
- le but est de figer une méthode d'observation avant de reconstruire `EconomicOperation`.

## Question centrale

Le système doit répondre à deux questions différentes :

1. **Qu'est-ce qui s'est réellement passé pour le compte du personnage observé ?**
2. **À quelle opération économique cette preuve appartient-elle ?**

La première question doit partir d'une preuve d'exécution explicite.
La seconde doit appliquer une corrélation déterministe et refuser l'attribution lorsqu'elle n'est pas suffisamment démontrable.

Le modèle ne doit jamais transformer :
- disparition d'un ordre ;
- baisse de `volume_remain` ;
- mouvement d'asset ;
- variation de wallet ;
- évolution du carnet ;

en fill observé sans preuve directe.

## Contraintes actuelles du dépôt

Le dépôt possède déjà sur `main` :
- `WALLET_TRANSACTION`, `WALLET_JOURNAL`, `ASSET` et `ACTIVE_ORDER` côté Player ;
- pagination `from_id` pour les transactions ;
- persistance historique des observations Player ;
- provenance `source_kind / source_id / principal_scope / principal_id` ;
- `transaction_id` dans les transactions ;
- `order_id`, `volume_remain`, `volume_total`, `min_volume`, `range` dans les ordres ;
- historique de snapshots de marché et évolution d'ordres.

Aucune nouvelle source ESI n'est nécessaire pour la méthode retenue.

ESI recommande l'exploitation de `expires`, `last-modified` et `ETag`, ainsi que le respect des bornes de cache. La pagination `from_id` est conçue pour parcourir les historiques vers le passé et permet d'arrêter la collecte lorsqu'un enregistrement déjà connu est retrouvé.

Références :
- https://developers.eveonline.com/docs/services/esi/best-practices/
- https://developers.eveonline.com/docs/services/esi/pagination/from-id/
- https://developers.eveonline.com/blog/esi-endpoint-versioning-important-info-and-best-practices

## Critères d'évaluation

Échelle 0–5, utilisée ici comme **évaluation architecturale comparative**, pas comme benchmark de performance.

- **Qualité de preuve** : capacité à établir un fait économique.
- **Attribution** : capacité à rattacher la preuve à la bonne opération sans heuristique.
- **Partiel / multi-événement** : gestion des acquisitions/dispositions fractionnées.
- **Performance** : coût en appels, volume et traitement.
- **Durabilité ESI** : résistance aux changements, cache et versioning.
- **Simplicité** : surface de code et nombre d'états spéciaux.
- **Testabilité** : capacité à produire des fixtures déterministes.
- **Conformité au contrat #34** : respect de FACT/DERIVED et UNKNOWN/PARTIAL/ERROR/ABSENT.

## Matrice de comparaison

| Méthode | Preuve | Attribution | Partiel | Perf. | Durabilité | Simplicité | Testabilité | #34 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| M1 — Transaction-first | 5 | 4 | 5 | 4 | 5 | 4 | 5 | 5 |
| M2 — Order reconciliation | 2 | 2 | 4 | 3 | 3 | 2 | 4 | 1 |
| M3 — Asset/wallet delta | 2 | 1 | 4 | 4 | 4 | 3 | 4 | 2 |
| M4 — Journal-context-first | 3 | 3 | 4 | 4 | 5 | 3 | 5 | 4 |
| M5 — Hybrid evidence-first | 5 | 5* | 5 | 4 | 5 | 3 | 5 | 5 |

* Attribution = 5 uniquement parce que la méthode prévoit explicitement **de ne pas attribuer** lorsqu'une correspondance unique et démontrable n'existe pas.

## Méthode retenue

### M5 — Hybrid evidence-first

M5 devient la **méthode cible**, avec M1 comme noyau de preuve d'exécution.

Principe :

```
Transaction ESI
      ↓
preuve économique directe
      +
Journal ESI
      ↓
contexte / corrélation éventuelle
      +
Asset / wallet
      ↓
corroboration de l'état
      +
Active / historical orders
      ↓
provenance / contexte de marché
      +
Market snapshots
      ↓
contexte observé
```

Règle fondamentale :

> Une source secondaire ne peut jamais transformer une absence de preuve directe en fill observé.

### Pourquoi cette méthode

1. Elle réutilise les données déjà collectées.
2. Elle permet de produire un événement économique réel à partir de `transaction_id`.
3. Elle supporte naturellement plusieurs transactions pour une même opération.
4. Elle permet d'enrichir une preuve sans mélanger preuve et contexte.
5. Elle autorise l'état `UNKNOWN` lorsque plusieurs transactions sont compatibles mais qu'aucune attribution unique n'est démontrable.
6. Elle ne dépend pas de la disparition d'un ordre.
7. Elle ne dépend pas d'une nouvelle API ESI.
8. Elle peut être optimisée par curseur `from_id` sans modifier la sémantique.

## M1 — Transaction-first

### Principe

Prendre `EsiWalletTransaction.transaction_id` comme unité primaire d'exécution économique.

Champs déjà présents :
- `transaction_id`
- `date`
- `is_buy`
- `quantity`
- `unit_price`
- `type_id`
- `location_id`
- `client_id`

### Ce que M1 permet

- établir une acquisition ou une vente observée ;
- conserver la quantité exacte et le prix exacts ;
- gérer plusieurs transactions pour une même opération ;
- conserver une provenance character-scoped explicite.

### Limites

- le contrat courant ne contient pas directement `order_id` ;
- frais et taxation ne sont pas entièrement portés par cette structure ;
- une transaction identique sur le même type/localisation peut créer une ambiguïté d'attribution entre plusieurs opérations.

### Décision

**Conserver.**

M1 doit constituer le chemin nominal de preuve d'exécution.

## M2 — Order reconciliation

### Principe

Reconstituer les fills à partir :
- de l'ordre actif ;
- de son `volume_remain` ;
- de l'ordre historique ;
- éventuellement de snapshots successifs.

### Problème structurel

Une variation d'ordre démontre une variation d'état d'ordre, pas la cause de cette variation.

Cela peut permettre de constater :
- ordre modifié ;
- ordre disparu ;
- volume restant différent.

Cela ne permet pas, sans autre preuve, de conclure :
- fill ;
- quantité remplie ;
- moment exact du fill ;
- attribution à une opération précise.

### Décision

**Rejeter comme méthode de preuve primaire.**

Peut rester une source de contexte et de provenance autour d'un événement déjà établi.

## M3 — Asset/wallet delta

### Principe

Corréler :
- variation d'inventaire ;
- variation de wallet ;
- éventuellement journal ;
- snapshots avant/après.

### Problème

Une variation d'asset n'établit pas à elle seule :
- l'origine économique ;
- le lien avec un ordre ;
- le prix exact ;
- la transaction exacte.

Une variation de wallet peut également avoir des causes multiples.

### Décision

**Rejeter comme méthode primaire.**

**Conserver comme corroboration** lorsque l'événement direct existe.

## M4 — Journal-context-first

### Principe

Utiliser le journal wallet comme point d'entrée :
- `ref_type` ;
- `amount` ;
- parties ;
- contexte éventuel ;
- `context_id_type` / `context_id` lorsqu'ils sont fournis.

### Intérêt

Le journal peut fournir du contexte économique et certains rattachements de marché plus riches que la transaction seule.

### Limite

Le journal ne constitue pas à lui seul un contrat suffisamment riche pour reconstruire systématiquement :
- type ;
- quantité ;
- prix unitaire ;
- allocation à une opération précise.

### Décision

**Conserver comme source secondaire de corrélation et de qualification.**

## M5 — Hybrid evidence-first

### Règle d'attribution

Pour qu'un événement devienne `OBSERVED` :

1. une preuve directe admissible doit exister ;
2. les attributs déterminants doivent être compatibles ;
3. l'association à une opération doit être unique ou explicitement fournie ;
4. toute ambiguïté doit produire `UNKNOWN` / `PARTIAL`, jamais une attribution arbitraire.

### Exemple

Deux opérations ouvertes concernent le même `type_id` et la même station.
Une transaction ESI arrive avec :
- même type ;
- même station ;
- quantité compatible ;
- date compatible.

Mais aucune règle déterministe ne permet de savoir à quelle opération elle appartient.

Résultat attendu :

```
transaction = OBSERVED
operation attribution = UNKNOWN
```

et non :

```
operation A = fill confirmé
```

### Conséquence pour `EconomicOperation`

L'identité d'opération reste indépendante :
- du `transaction_id` ;
- de l'`order_id` ;
- de l'issuer ;
- du character observateur.

La transaction devient une **evidence record**.

## Optimisation performance proposée

La correction et la performance doivent être séparées en deux étapes.

### Étape P1 — correctness

À chaque synchronisation :
- conserver les observations brutes ;
- réutiliser `transaction_id` comme identité de preuve ;
- éviter toute attribution heuristique ;
- reconstruire les opérations depuis les preuves persistées.

### Étape P2 — incremental ingestion

Le code actuel sait utiliser `from_id`, mais démarre la récupération sans curseur persistant.

Optimisation cible :
- persister un high-water mark / plus récent `transaction_id` connu ;
- demander les transactions récentes ;
- arrêter la pagination dès qu'un identifiant déjà connu est rencontré ;
- respecter les headers `expires` / `ETag` ;
- conserver les réponses et métadonnées d'observation.

Cette optimisation ne doit changer aucune règle de vérité économique.

## Question des ordres et de l'issuer

Un `order_id` et un issuer de marché restent des données de provenance.

Le fait qu'une transaction économique soit observée sur le wallet d'un character ne signifie pas que :
- le character possédait le SELL public rencontré ;
- l'issuer du SELL est le propriétaire de l'opération ;
- la corporation de l'observateur est la source économique de la liquidité publique.

Le modèle doit donc conserver les deux axes :

```
economic owner / observer scope
        ≠
public market evidence / issuer
```

## Question de la rentabilité partielle

Une preuve de transaction peut alimenter une **sous-disposition**.

Elle ne doit pas transformer automatiquement :
```
10 000 acquis
1 vendu avec marge positive
```
en :
```
opération rentable / terminée
```

L'opération globale reste dépendante :
- de sa quantité restante ;
- de sa complétude ;
- des coûts connus/inconnus ;
- de la politique explicite de résultat courant/terminal.

## Décisions préparatoires pour les sous-chantiers suivants

### À implémenter plus tard

- un résolveur d'evidence déterministe ;
- une identité de transaction conservée en preuve ;
- un mécanisme explicite d'ambiguïté ;
- un high-water mark transactionnel ;
- la corrélation secondaire avec journal/orders/assets ;
- les résultats observés/courants/terminaux selon le contrat #30/#34.

### À ne pas implémenter dans ce sous-chantier

- fill inference par disparition d'ordre ;
- FIFO ;
- ledger comptable caché ;
- matching probabiliste ;
- nouvelle source ESI ;
- exécution réelle ;
- E2E Codespace.

## Décision finale de l'étude

**Retenu : M5 — Hybrid evidence-first**, avec **M1 — Transaction-first comme source primaire de vérité pour l'exécution observée**.

**Conservé comme soutien :**
- M4 Journal-context-first ;
- M3 Asset/wallet delta ;
- ordres et snapshots de marché comme provenance/contexte.

**Rejeté comme source de fill :**
- M2 Order reconciliation seule.

La suite de #34 peut maintenant être découpée autour de ce contrat sans reprendre le volume de la PR #33.
