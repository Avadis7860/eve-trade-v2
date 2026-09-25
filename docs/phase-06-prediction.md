# Phase 6 — Prediction

## Incrément 01 — dataset point-in-time et baseline empirique

Phase 6 introduit une frontière explicite entre les observations Phase 5 et les artefacts de prédiction.

Le pipeline est :

```
OpportunityObservation / OpportunityOutcome
        ↓
materialisation déterministe du dataset
        ↓
features disponibles à t
        ↓
targets observables après t
        ↓
split temporel sans mélange de trajectoires
        ↓
baseline empirique
        ↓
évaluation sur holdout
        ↓
inférence traçable
```

## Contrat

Le contrat `phase-06.1` expose :

- `PredictionDataset` et son identifiant déterministe ;
- la version du dataset et de sa configuration ;
- la fenêtre de features ;
- l'horizon et la tolérance de labellisation ;
- le scope/provenance de chaque sample ;
- les features calculées uniquement depuis le point de référence ou son passé ;
- les targets et leur état `POSITIVE` / `NEGATIVE` / `UNKNOWN` ;
- les identifiants des observations ayant produit le label ;
- l'état explicite `INSUFFICIENT_DATA` lorsque le corpus ne permet pas d'entraîner la baseline.

Le fingerprint du dataset ne dépend pas de l'ordre d'arrivée des observations. Les entrées sont normalisées puis triées avant fingerprinting.

## Features

Le premier jeu de features reste volontairement transparent :

- présence observée à la date de référence ;
- état de fraîcheur ;
- quantité demandée ;
- quantité remplie par les deux legs ;
- ratio de remplissage lorsque la quantité demandée est valide ;
- résultat net simulé et retour simulé lorsqu'ils sont disponibles ;
- nombre d'observations strictement antérieures ;
- délai depuis l'observation précédente ;
- présence précédente ;
- résultat net simulé précédent.

Aucune feature n'est reconstruite à partir d'une observation future.

Une observation à la même seconde que la référence n'est pas traitée comme un « passé » supplémentaire : seules les observations dont `observed_at < feature_observed_at` contribuent aux features historiques.

## Targets

### `PRESENCE_AT_HORIZON`

Le target représente la présence observable de l'opportunité au voisinage de l'horizon :

```
reference t
  +
prediction_horizon
  ↓
première observation connue dans
[target, target + max_label_lag]
```

- `PRESENT` → `POSITIVE` ;
- `ABSENT` → `NEGATIVE` ;
- uniquement `UNAVAILABLE` ou aucune observation exploitable → `UNKNOWN`.

Ce contrat ne prétend pas démontrer une continuité ininterrompue entre `t` et `t+h`. Il utilise une preuve d'état observée après l'horizon et expose `target_observed_at`.

### `OUTCOME_OBSERVED_AT_HORIZON`

Le target consomme uniquement une preuve d'outcome compatible avec le scope du sample :

- `COMPLETELY_OBSERVED` → `POSITIVE` ;
- `NO_EVIDENCE`, `PARTIALLY_OBSERVED`, `UNKNOWN` ou `NOT_OBSERVED` → `UNKNOWN`.

Une évidence CHARACTER appartenant à un autre personnage ne peut pas labelliser le sample courant. Une preuve composée de scopes différents est également rejetée comme label exploitable.

Un outcome partiel reste donc un état de données, jamais une réalisation complète et jamais un profit réalisé.

## Anti-leakage

La matérialisation respecte les contraintes suivantes :

- les features utilisent exclusivement l'observation de référence et les observations strictement antérieures du même stream ;
- un label est postérieur à l'observation de référence ;
- les targets portent leur propre `target_observed_at` ;
- les streams sont définis par `opportunity_id + principal_scope + principal_id` ;
- les scopes différents ne sont jamais fusionnés ;
- les trajectories traversant la frontière temporelle d'évaluation sont exclues des deux côtés du split ;
- un échantillon sans label exploitable n'est pas transformé en label négatif.

Le split est donc volontairement conservateur : un stream présent avant et après `evaluation_start` est exclu afin de ne pas faire apparaître une même trajectoire dans train et test.

## Baseline modèle

Le premier modèle livré est une baseline empirique globale :

```
estimated_positive_rate
  =
positive_labels / labeled_training_samples
```

Caractéristiques :

- déterministe ;
- sans dépendance ML externe ;
- reproductible à dataset et version de modèle identiques ;
- seuil minimal de taille de corpus explicite ;
- fingerprint du modèle incluant les samples d'entraînement labellisés.

Le modèle ne revendique pas de calibration. L'inférence retourne seulement :

- statut ;
- target ;
- version modèle ;
- dataset source ;
- taille d'échantillon ;
- taux empirique observé ;
- échantillon de référence, date de feature, scope et provenance lorsqu'une observation d'inférence est fournie ;
- statut de qualité explicite (`TRAINING_ONLY` ou `INSUFFICIENT_DATA`) ;
- `confidence = NOT_ASSESSED`, tant qu'aucune calibration/confidence n'est démontrée.

La fenêtre temporelle utilisée pour l'entraînement est également conservée dans le modèle.

Sous le seuil minimal, l'entraînement retourne `INSUFFICIENT_DATA` et aucun taux n'est produit.

## Évaluation

L'évaluation utilise uniquement le holdout temporel indépendant.

La baseline expose :

- nombre d'échantillons évalués ;
- nombre de positifs/négatifs ;
- accuracy ;
- Brier score ;
- état `calibration_status = NOT_ASSESSED` ;
- point de départ de la période d'évaluation dans le contrat de résultat lorsqu'il est fourni par le pipeline.

Les métriques sont donc des mesures sur un échantillon identifié ; elles ne sont pas présentées comme une garantie de performance future.

## Persistance et reproductibilité

Le dataset est entièrement reconstructible depuis les observations Phase 5 et ses métadonnées portent :

- `dataset_id` ;
- version de contrat ;
- version métier du dataset ;
- fenêtre temporelle ;
- horizon ;
- tolérance de labellisation ;
- tailles d'entrée et de sortie.

La couche DB expose la lecture complète des observations et outcomes, sans introduire de nouvelle source externe.

Le fingerprint constitue l'identité de l'artefact reconstruit ; aucune date de création variable n'entre dans ce fingerprint.

## Scopes et provenance

Le dataset conserve le scope de chaque observation jusqu'au sample.

La provenance publique du marché et la provenance character-scoped sont conservées séparément. Le pipeline ne transforme pas l'observateur en propriétaire des données publiques et n'utilise pas une observation CHARACTER pour enrichir silencieusement un sample PUBLIC.

## Limites de cet incrément

Cet incrément ne fournit pas encore :

- un modèle conditionnel par type de marché ;
- une prédiction dédiée de spread/profondeur/liquidité ;
- une calibration statistique démontrée ;
- une génération automatique périodique des observations Phase 5 depuis le worker d'analyse ;
- une API/UI de prédiction ;
- du scoring ou du conseil.

Ces responsabilités restent soumises aux frontières définies dans l'issue Phase 6 et aux phases downstream.
