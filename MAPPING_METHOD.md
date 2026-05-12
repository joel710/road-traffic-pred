# Méthodologie de Cartographie (Dataset → Map)

Ce document explique comment les flux de données (streaming via Apache Spark) et les données tabulaires de prédiction (issues des modèles LSTM) sont transposés sur la carte interactive de manière "naturelle" et fluide.

## 1. De l'ID à la Coordonnée
Le dataset original utilise des identifiants de jonction (`J1`, `J2`, `J3`, `J4`). Pour une visualisation réaliste, ces IDs sont mappés à des coordonnées GPS précises au sein de Paris :

| ID | Nom | Latitude | Longitude | Rôle dans le Dataset |
| :--- | :--- | :--- | :--- | :--- |
| **J1** | Porte de la Chapelle (Nord) | 48.8866 | 2.3522 | Entrée périphérique Nord |
| **J2** | Champs-Élysées | 48.8696 | 2.3076 | Centre touristique / Axe majeur |
| **J3** | Place d'Italie | 48.8266 | 2.3552 | Hub Sud / Résidentiel |
| **J4** | Bastille | 48.8536 | 2.3792 | Hub Est / Sortie centre |

## 2. Mapping des "Jointures" (Itinéraires)
Contrairement à une représentation rigide (lignes droites), nous utilisons des **GeoJSON MultiLineStrings** qui suivent la topologie réelle des rues parisiennes.

### Technique : Interpolation par segments routiers
Au lieu de `Line(A, B)`, nous utilisons un tableau de coordonnées `[Lat, Lng]` récupérées via l'API OpenStreetMap (OSRM) pour chaque itinéraire :
- **J1 → J2** : Suit le Boulevard Ney et les boulevards extérieurs.
- **J2 → J4** : Suit l'axe historique Rue de Rivoli.
- **J3 → J4** : Emprunte les grands boulevards du 13e vers le 11e.

## 3. Visualisation de l'Intensité (Traffic Flow)
Le flux de véhicules (`Vehicles`) prédit par l'IA est traduit en propriétés visuelles dynamiques :
- **Couleur** : Échelle HSL allant du Vert (`fluid`, < 2500 veh/h) à l'Orange Brûlé (`congested`, > 3500 veh/h).
- **Épaisseur** : La largeur de la ligne varie légèrement pour simuler la densité.
- **Animation de flux** : Un effet de "Dash Array" animé (faisceau lumineux) se déplace le long du segment, avec une vitesse inversement proportionnelle à la congestion.

## 4. Transitions et Changements d'Angle
Pour briser la rigidité du 2D, l'interface utilise les capacités vectorielles de **MapLibre GL** :
- **Sélection de jonction** : Déclenche un `flyTo` avec un `pitch` de 45° et une rotation (`bearing`) pour mettre en perspective l'itinéraire sélectionné.
- **Progression temporelle** : Lors du changement d'heure via le slider, les couleurs des segments s'interpolent de manière fluide (Linear Interpolation) pour éviter les sauts brusques de couleur.

---
*Réalisé par Joel ADZONYA & Ghislaine EKLOU*
