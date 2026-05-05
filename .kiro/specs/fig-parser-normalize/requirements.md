### Requirement 1: isKiwiEnumValue

`isKiwiEnumValue` shall identify raw Kiwi enum objects during fig parser IO
normalization.

#### 1.1: Kiwi enum predicate

WHEN fig parser IO normalizes raw Kiwi values, THEN `isKiwiEnumValue` SHALL
return whether a value is a Kiwi enum object.
