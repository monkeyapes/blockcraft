"""Entry point for Blockcraft."""

import sys


def main():
    # pyglet's shadow window trips up some drivers under a frozen build.
    import pyglet
    if getattr(sys, "frozen", False):
        pyglet.options["shadow_window"] = False

    from voxel.game import run
    run()


if __name__ == "__main__":
    main()
