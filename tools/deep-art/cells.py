"""Cell rectangles of sheet.png (7 rows x 5 cards) in species order, found by measuring the gaps."""
ROWS = [(5, 174), (179, 342), (348, 505), (510, 677), (683, 855), (860, 1018), (1023, 1204)]
SEPS = [
    [223.5, 500.5, 761.5, 1042],
    [223.5, 500.5, 761.5, 1042],
    [223.5, 500.5, 761.5, 1041.5],
    [249.5, 508.5, 761.5, 1041.5],
    [249.5, 530.5, 774.5, 1065.5],
    [259, 532, 781.5, 1046.5],
    [256, 531.5, 798.5, 1027.5],
]
WIDTH = 1299


def cells():
    out = []
    for (top, bottom), seps in zip(ROWS, SEPS):
        edges = [2] + seps + [WIDTH - 2]
        for i in range(5):
            out.append((int(edges[i] + 4), top + 3, int(edges[i + 1] - 3), bottom - 2))
    return out
