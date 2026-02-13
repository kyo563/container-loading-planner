import unittest


class SmokeTest(unittest.TestCase):
    def test_import_domain_modules(self):
        import container_planner  # noqa: F401
        import container_planner.io  # noqa: F401
        import container_planner.models  # noqa: F401
        import container_planner.packing  # noqa: F401
        import container_planner.planner  # noqa: F401


if __name__ == '__main__':
    unittest.main()
