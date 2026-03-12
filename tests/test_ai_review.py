import unittest

import pandas as pd

from container_planner.ai_review import build_ai_review_prompt, parse_ai_review_response


class AIReviewTest(unittest.TestCase):
    def test_build_prompt_contains_summary_and_placement(self):
        summary_df = pd.DataFrame([{"type": "40HC", "count": 2}])
        placement_df = pd.DataFrame(
            [
                {
                    "container_label": "40HC-1",
                    "cargo_piece_id": "A001-1",
                    "cargo_desc": "Machine",
                    "cargo_weight_kg": 1200,
                    "cargo_m3": 2.5,
                    "placed_x_cm": 10,
                    "placed_y_cm": 20,
                    "placed_z_cm": 0,
                    "oog_flag": False,
                    "special_container_reason": "",
                }
            ]
        )

        prompt = build_ai_review_prompt(summary_df, placement_df)

        self.assertIn("[集計結果CSV]", prompt)
        self.assertIn("40HC,2", prompt)
        self.assertIn("[配置サマリCSV", prompt)
        self.assertIn("A001-1", prompt)

    def test_parse_json_response(self):
        text = (
            '{"caution_points":["重量集中"],"check_items":["法令確認"],'
            '"improvement_suggestions":["重量分散"]}'
        )
        result = parse_ai_review_response(text)

        self.assertEqual(result.caution_points, ["重量集中"])
        self.assertEqual(result.check_items, ["法令確認"])
        self.assertEqual(result.improvement_suggestions, ["重量分散"])

    def test_parse_invalid_response_sets_fallback(self):
        result = parse_ai_review_response("想定外レスポンス")
        self.assertEqual(result.caution_points, [])
        self.assertTrue(result.check_items)


if __name__ == "__main__":
    unittest.main()
