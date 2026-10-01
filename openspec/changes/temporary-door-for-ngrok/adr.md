## ADR Review Manifest

- ADR 0004 (review API v1 matches Lavish): unchanged; the temporary door never exposes it.
- ADR 0005 (one upstream annotate server per Review): unchanged; the door reaches the page through the service's own forwarding.
- ADR 0006 (the service answers the page decisions): unchanged; the door passes the page's commands to the same handlers.
- ADR 0007 (doors serve only their Visibility): amended with the temporary door's loopback address, peer and single host, and with "a door opens only when its port is set; the LaunchAgent sets the live ports". The decision it records is the same door design; the amendment fills in the second door story 10 left to story 11.
