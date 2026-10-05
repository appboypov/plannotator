## ADDED Requirements

### Requirement: The service posts to Multica as the skuddy profile
The LaunchAgent plist SHALL set `PLANNOTATOR_MULTICA_PROFILE=skuddy`, so a linked Review's comments post as the member of the Multica CLI profile `skuddy`; `PLANNOTATOR_MULTICA_PROFILE` set in the installing shell SHALL be carried over it. The plist SHALL hold the profile name only, never a token: the service reads the profile's server URL and token from `~/.multica/profiles/<profile>/config.json` at each post.

#### Scenario: The installed service names the profile
- **GIVEN** the install command has run without `PLANNOTATOR_MULTICA_PROFILE` in its shell
- **WHEN** launchd starts the service
- **THEN** its environment has `PLANNOTATOR_MULTICA_PROFILE=skuddy` and no Multica token
