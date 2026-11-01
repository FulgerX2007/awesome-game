"""MathMagic level scenes, written as plain .tscn files from short Python descriptions.

    python3 tools/mathmagic/levels.py            # all levels
    python3 tools/mathmagic/levels.py level7     # one level

Coordinates: x runs along the path, y is up; the mage walks on z = 0, negative z is behind the path and
positive z in front of it (toward the camera). Ground(x, y, L) covers x - 1 .. x + 2L - 1 with its top at y.
Decor is seeded, so running this again gives the same files. Levels 1-5 are the Island of Addition,
6-8 Multiplication Mountains (see scripts/progression/level_catalog.gd).
"""
import sys, os, random
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'godot', 'mathmagic', 'scenes', 'levels')
SCRIPTS = {
 'level':'res://scripts/gameplay/level.gd','ground':'res://scripts/world/ground.gd','prop':'res://scripts/world/prop.gd',
 'pickup':'res://scripts/gameplay/pickup.gd','gate':'res://scripts/gameplay/gate_puzzle.gd','bridge':'res://scripts/gameplay/bridge_puzzle.gd',
 'energy':'res://scripts/gameplay/energy_puzzle.gd','lift':'res://scripts/world/lift.gd','sign':'res://scripts/world/sign_post.gd',
 'checkpoint':'res://scripts/gameplay/checkpoint.gd','goal':'res://scripts/gameplay/goal.gd','windmill':'res://scripts/world/windmill.gd',
 'boss':'res://scripts/bosses/stone_guardian.gd','steps':'res://scripts/gameplay/steps_puzzle.gd',
}
def q(s): return '"' + s.replace('\\','\\\\').replace('"','\\"') + '"'
def tf(x,y,z=0.0,s=1.0,ry=0.0):
    import math
    c,sn=math.cos(math.radians(ry)),math.sin(math.radians(ry))
    return 'Transform3D(%g, 0, %g, 0, %g, 0, %g, 0, %g, %g, %g, %g)' % (c*s, -sn*s, s, sn*s, c*s, x, y, z)

class Lvl:
    def __init__(self, name, index, cmin, cmax, intro):
        self.name, self.index, self.cmin, self.cmax, self.intro = name, index, cmin, cmax, intro
        self.nodes=[]; self.used=set(['level']); self.counts={}
        self.terrain = False   # True: ground pieces use the sculpted Terrain mesh instead of hex tiles
    def _n(self, base):
        self.counts[base]=self.counts.get(base,0)+1
        return '%s%d' % (base, self.counts[base])
    def add(self, kind, typ, name, x, y, z=0.0, s=1.0, ry=0.0, props=None, parent='.'):
        self.used.add(kind)
        self.nodes.append((name, typ, kind, tf(x,y,z,s,ry), props or {}, parent))
        return name
    def ground(self, x, y, L, h=3, rows=3):
        props = {'length':L,'height':h,'rows':rows}
        if self.terrain: props['style'] = '"terrain"'
        return self.add('ground','StaticBody3D',self._n('Ground'),x,y,props=props)
    def plat(self, x, y, L=1):
        if self.terrain:  # a grassy wedge of rock, drawn deeper than it is solid so it never blocks a jump
            return self.add('ground','StaticBody3D',self._n('Platform'),x,y,props={'length':L,'height':2,'rows':1,'style':'"terrain"','taper':0.85,'solid':0.9})
        return self.add('ground','StaticBody3D',self._n('Platform'),x,y,props={'length':L,'height':1,'rows':1,'style':'"island"'})
    def kdecor(self, xs, y, seed):
        """Kenney Mini Forest dressing: little plants and grass patches at the front, tall pines behind."""
        r = random.Random(seed)
        for x in xs:
            self.prop(r.choice(['kenney_forest/plant','kenney_forest/patch-grass','kenney_forest/plant']), x + r.uniform(-0.4, 0.4), y, r.uniform(1.6, 2.4), r.uniform(1.8, 2.4), r.uniform(0, 360))
            if r.random() < 0.4:
                self.prop('kenney_forest/tree-high', x + r.uniform(-0.6, 0.6), y, r.uniform(-4.4, -3.6), r.uniform(1.8, 2.2), r.uniform(0, 360))
    def stone(self, x, y): return self.add('pickup','Area3D',self._n('Stone'),x,y,props={'kind':'"stone"'})
    def gem(self, x, y): return self.add('pickup','Area3D',self._n('Gem'),x,y,props={'kind':'"gem"'})
    def prop(self, model, x, y, z, s=1.0, ry=0.0): return self.add('prop','Node3D',self._n('Prop'),x,y,z,s,ry,{'model':q(model)})
    def sign(self, x, y, text, z=None):
        if z is None: z = -1.6 if self.terrain else -2.2   # in front of the trees in the mountains
        return self.add('sign','Node3D',self._n('Sign'),x,y,z,props={'text':q(text)})
    def checkpoint(self, x, y): return self.add('checkpoint','Area3D',self._n('Checkpoint'),x,y,-0.9)
    def goal(self, x, y, hidden=False): return self.add('goal','Area3D','Goal',x,y,props={'hidden':'true'} if hidden else {})
    def boss(self, x, y): return self.add('boss','Node3D','StoneGuardian',x,y)
    def gate(self, x, y, skill, lo, hi, objective, show=True):
        return self.add('gate','Node3D',self._n('Gate'),x,y,props={'skill':q(skill),'min_difficulty':lo,'max_difficulty':hi,'objective':q(objective),'show_objects':'true' if show else 'false'})
    def bridge(self, x, y, gap, maxm, lo, hi, objective="Fix the bridge."):
        return self.add('bridge','Node3D',self._n('Bridge'),x,y,props={'skill':'"missing"','gap':float(gap),'max_missing':maxm,'min_difficulty':lo,'max_difficulty':hi,'objective':q(objective)})
    def energy(self, x, y, target, lo, hi, objective, windmill=None):
        p={'skill':'"missing"','min_difficulty':lo,'max_difficulty':hi,'objective':q(objective),'target':'NodePath("../%s")'%target}
        if windmill: p['windmill']='NodePath("../%s")'%windmill
        return self.add('energy','Node3D',self._n('Machine'),x,y,props=p)
    def steps(self, x, y, lo, hi, objective, height=3.2, run=5.0, max_steps=5):
        """Crystal steps from x up to a cliff whose face is at x + run and whose top is height above y."""
        return self.add('steps','Node3D',self._n('Steps'),x,y,props={'skill':'"mul"','min_difficulty':lo,'max_difficulty':hi,'objective':q(objective),'height':float(height),'run':float(run),'max_steps':max_steps})
    def lift(self, x, y, travel): return self.add('lift','AnimatableBody3D',self._n('Lift'),x,y,props={'travel':'Vector3(0, %g, 0)'%travel})
    def windmill(self, x, y, z, s): return self.add('windmill','Node3D',self._n('Windmill'),x,y,z,s)
    def spawn(self, x, y): self.nodes.append(('Spawn','Marker3D',None,tf(x,y),{},'.'))
    def scenery(self, x0, x1, seed):
        """Background and foreground dressing, seeded so the file stays stable."""
        r = random.Random(seed)
        far = ['hexagon/mountain_A_grass_trees','hexagon/mountain_C_grass_trees','hexagon/hills_A_trees','hexagon/mountain_B_grass','hexagon/hill_single_A']
        x = x0 - 14
        while x < x1 + 14:
            self.prop(r.choice(far), x, -1.2, r.uniform(-13.5, -10.5), r.uniform(3.2, 4.4), r.uniform(0, 360)); x += r.uniform(5, 8)
        x = x0 - 10
        while x < x1 + 10:
            self.prop(r.choice(['hexagon/cloud_big','hexagon/cloud_small']), x, r.uniform(8, 11), r.uniform(-16, -12), r.uniform(1.6, 2.4)); x += r.uniform(10, 16)
    def mscenery(self, x0, x1, seed):
        """Multiplication Mountains in the distance: KayKit rock formations in two rows (the far row bigger and
        lower, so the range has depth), pines on the near row, and a few clouds."""
        r = random.Random(seed)
        far = ['Rock_3_Q', 'Rock_3_R', 'Rock_3_P', 'Rock_3_O']      # KayKit's rounded boulders: no stacked blocks
        tall = ['Rock_3_M', 'Rock_3_N', 'Rock_3_O', 'Rock_3_P']
        x = x0 - 16
        while x < x1 + 16:
            self.prop('kaykit_forest/%s_Color1' % r.choice(far), x, -5.5, r.uniform(-36, -30), r.uniform(3.0, 4.0), r.uniform(0, 360)); x += r.uniform(9, 13)
        x = x0 - 14
        while x < x1 + 14:
            self.prop('kaykit_forest/%s_Color1' % r.choice(tall), x, -2.8, r.uniform(-18, -15), r.uniform(1.0, 1.4), r.uniform(0, 360))
            if r.random() < 0.6:
                self.prop('kaykit_forest/Tree_4_%s_Color1' % r.choice('ABC'), x + r.uniform(1.2, 2.2), -1.4, r.uniform(-14.5, -13), r.uniform(0.7, 1.0), r.uniform(0, 360))
            x += r.uniform(6, 9)
        x = x0 - 10
        while x < x1 + 10:
            self.prop(r.choice(['hexagon/cloud_big','hexagon/cloud_small']), x, r.uniform(8, 10.5), r.uniform(-18, -14), r.uniform(1.8, 2.6)); x += r.uniform(9, 14)
    def mdecor(self, xs, y, seed, front=True):
        """Mountain dressing from one family (KayKit Forest): a pine or a round tree well behind the path, with a
        bush at its foot, and sometimes a boulder or a grass tuft at the front edge. Trees stand back far enough
        that they never hide the hero, a sign or a puzzle."""
        r = random.Random(seed)
        for x in xs:
            tree = r.choice(['Tree_4_A', 'Tree_4_B', 'Tree_4_C', 'Tree_1_A', 'Tree_1_B', 'Tree_3_A'])
            self.prop('kaykit_forest/%s_Color1' % tree, x + r.uniform(-0.4, 0.4), y, r.uniform(-3.6, -2.9), r.uniform(0.7, 0.95), r.uniform(0, 360))
            self.prop('kaykit_forest/Bush_%s_Color1' % r.choice(['1_D', '1_E', '1_F', '3_B', '1_C']), x + r.uniform(-1.0, 1.0), y, r.uniform(-3.0, -2.5), r.uniform(0.9, 1.2), r.uniform(0, 360))
            if front and r.random() < 0.7:
                k = r.choice(['Rock_3_D', 'Rock_3_E', 'Rock_3_F', 'Rock_3_G', 'Grass_1_A', 'Grass_2_A', 'Grass_1_B'])
                self.prop('kaykit_forest/%s_Color1' % k, x + r.uniform(-0.8, 0.8), y - 0.05, r.uniform(2.0, 2.4), r.uniform(0.9, 1.3) if 'Rock' in k else r.uniform(1.6, 2.0), r.uniform(0, 360))
    def krocks(self, xs, y, seed):
        """KayKit boulders at the front edge, half sunk into the grass."""
        r = random.Random(seed)
        for x in xs:
            self.prop('kaykit_forest/%s_Color1' % r.choice(['Rock_3_G', 'Rock_3_H', 'Rock_3_I', 'Rock_3_J']), x, y, r.uniform(2.0, 2.3), r.uniform(0.45, 0.65), r.uniform(0, 360))
    def ndecor(self, xs, y, seed):
        """Quaternius nature: a bush behind the path and a clump of flowers or grass in front, per x."""
        r = random.Random(seed)
        bushes = ['nature/Bush', 'nature/Bush_Flowers', 'nature/Bush_Large', 'nature/Bush_Large_Flowers', 'nature/Bush_Small', 'nature/Bush_Small_Flowers']
        small = ['nature/Flower_1_Clump', 'nature/Flower_2_Clump', 'nature/Flower_3_Clump', 'nature/Flower_4_Clump', 'nature/Flower_5_Clump', 'nature/Grass_Large', 'nature/Grass_Small', 'nature/Plant_1', 'nature/Plant_Flowers']
        for x in xs:
            self.prop(r.choice(bushes), x + r.uniform(-0.5, 0.5), y, r.uniform(-1.9, -1.4), r.uniform(0.8, 1.1), r.uniform(0, 360))
            self.prop(r.choice(small), x + r.uniform(-0.8, 0.8), y, r.uniform(1.9, 2.6), r.uniform(1.2, 1.6), r.uniform(0, 360))

    def trees(self, xs, y, seed, z=-2.0):
        r = random.Random(seed)
        for x in xs:
            m = r.choice(['hexagon/tree_single_A','hexagon/tree_single_B','hexagon/trees_A_medium','hexagon/trees_B_small'])
            self.prop(m, x, y, z + r.uniform(-0.4, 0.3), r.uniform(2.2, 2.8), r.uniform(0, 360))
    def rocks(self, xs, y, seed, z=1.9):
        r = random.Random(seed)
        for x in xs:
            self.prop(r.choice(['hexagon/rock_single_A','hexagon/rock_single_B','hexagon/rock_single_C','hexagon/rock_single_D']), x, y, z + r.uniform(-0.2, 0.4), r.uniform(2.5, 3.5), r.uniform(0, 360))
    def write(self):
        ids = {k:str(i+1) for i,k in enumerate(sorted(self.used))}
        out=['[gd_scene format=3]','']
        for k in sorted(self.used):
            out.append('[ext_resource type="Script" path="%s" id="%s"]' % (SCRIPTS[k], ids[k]))
        out += ['', '[node name="%s" type="Node3D"]' % self.name, 'script = ExtResource("%s")' % ids['level'],
                'level_index = %d' % self.index, 'camera_min_x = %g' % self.cmin, 'camera_max_x = %g' % self.cmax,
                'intro = PackedStringArray(%s)' % ', '.join(q(s) for s in self.intro), '']
        for name, typ, kind, t, props, parent in self.nodes:
            out.append('[node name="%s" type="%s" parent="%s"]' % (name, typ, parent))
            out.append('transform = %s' % t)
            if kind: out.append('script = ExtResource("%s")' % ids[kind])
            for k,v in props.items(): out.append('%s = %s' % (k, v))
            out.append('')
        open(os.path.join(OUT, 'level_%d.tscn' % (self.index+1)),'w').write('\n'.join(out))

def level1():
    L = Lvl('CountingBeach', 0, 7, 55, ["Welcome to the Island of Addition!", "Count the stones to open the magic gates."])
    L.spawn(1, 0.6)
    L.ground(0, 0, 12)
    L.sign(4, 0, "A D or arrows: walk. Space: jump.")
    L.plat(8, 1.8, 2); L.gem(9, 1.8)
    L.gate(19, 0, 'add', 1, 1, "Count the stones. Open the gate!")
    L.ground(26, 0, 4)
    L.checkpoint(27, 0)
    L.ground(34, 1, 6, 4)
    L.plat(36, 2.8, 1); L.gem(36, 2.8)
    L.gate(43, 1, 'add', 1, 2, "Open the second gate!")
    L.ground(48, 0, 8)
    L.plat(52, 1.6, 1); L.gem(52, 1.6)
    L.goal(60, 0)
    L.kdecor([3, 11, 15, 29, 39, 50, 55], 0, 101)
    L.kdecor([35, 44], 1, 102)
    L.ndecor([5, 10, 26, 31, 51, 57], 0, 151)
    L.ndecor([37, 41], 1, 152)
    L.prop('kenney_forest/fence', 22, 0, 1.0, 2.2, 90)
    L.trees([2, 6, 14, 27, 31, 47, 56, 62], 0, 1)
    L.prop('hexagon/building_home_A_blue', -0.5, 0, -2.3, 2.4, 20)
    L.prop('hexagon/tent', 30.5, 0, -2.0, 2.2, -30)
    L.rocks([11, 29, 50, 58], 0, 2)
    L.prop('hexagon/building_well_green', 57, 0, -2.2, 2.2)
    L.scenery(0, 62, 3)
    L.write()

def level2():
    L = Lvl('BrokenBridges', 1, 7, 57, ["The storm broke the bridges.", "Collect stones and count the empty spots."])
    L.spawn(1, 0.6)
    L.ground(0, 0, 8)
    L.sign(3, 0, "Stones fix bridges. Collect them!")
    L.stone(5, 0); L.stone(7.5, 0); L.stone(10, 0)
    L.plat(12, 1.8, 1); L.stone(12, 1.8)
    L.bridge(15, 0, 6, 3, 1, 2, "Fix the bridge with stones.")
    L.ground(22, 0, 6)
    L.stone(24, 0); L.stone(26.5, 0); L.stone(29, 0)
    L.plat(27, 1.8, 1); L.gem(27, 1.8)
    L.ground(34, 1, 4, 4)
    L.stone(34.5, 1); L.stone(39.5, 1)
    L.plat(37, 2.8, 1); L.gem(37, 2.8)
    L.bridge(41, 1, 8, 5, 2, 3, "Fix the long bridge.")
    L.ground(50, 1, 8, 4)
    L.plat(54, 2.8, 1); L.gem(54, 2.8)
    L.goal(62, 1)
    L.kdecor([2, 8, 23, 30], 0, 111)
    L.kdecor([35, 52, 59], 1, 112)
    L.ndecor([4, 9, 25, 28], 0, 161)
    L.ndecor([51, 56, 61], 1, 162)
    L.prop('kenney_forest/tent', 31, 0, -2.6, 2.4, -20)
    L.trees([1.5, 6, 23, 29.5, 35, 52, 58, 64], 0, 11)
    L.prop('hexagon/building_home_B_red', 9, 0, -2.4, 2.3, -15)
    L.prop('hexagon/building_tower_A_blue', 56, 1, -2.5, 2.4)
    L.rocks([3, 25, 39, 60], 0, 12)
    L.scenery(0, 64, 13)
    L.write()

def level3():
    L = Lvl('GateGarden', 2, 7, 47, ["Some gates want you to take away.", "Take away means some stones go away."])
    L.spawn(1, 0.6)
    L.ground(0, 0, 7)
    L.sign(3, 0, "Take away: count the stones that stay.")
    L.gate(10, 0, 'sub', 1, 2, "Take away to open the gate.")
    L.ground(16, 0, 4)
    L.plat(19, 1.8, 1); L.gem(19, 1.8)
    L.ground(24, 1, 5, 4)
    L.checkpoint(25, 1)
    L.gate(31, 1, 'add', 2, 3, "Add to open the next gate.")
    L.ground(36, 0, 10)
    L.plat(40, 1.8, 1); L.gem(40, 1.8)
    L.plat(43, 3.4, 1); L.gem(43, 3.4)
    L.gate(48, 0, 'mixed', 2, 3, "The last gate! Add or take away?", show=False)
    L.goal(53, 0)
    L.kdecor([1, 6, 17, 21, 38, 45, 51], 0, 121)
    L.kdecor([27, 29], 1, 122)
    L.ndecor([3, 5, 16, 20, 39, 43, 50], 0, 171)
    L.ndecor([25, 28], 1, 172)
    L.trees([2, 7, 17, 22, 26, 37, 45, 51, 55], 0, 21)
    L.prop('hexagon/building_well_green', 21, 0, -2.3, 2.2)
    L.prop('hexagon/fence_wood_straight', 4, 0, 1.9, 2.4, 90)
    L.prop('hexagon/fence_wood_straight', 38, 0, 1.9, 2.4, 90)
    L.prop('hexagon/building_home_A_blue', 52, 0, -2.6, 2.3, -20)
    L.rocks([12, 29, 39, 50], 0, 22)
    L.scenery(0, 56, 23)
    L.write()

def level4():
    L = Lvl('WindmillHill', 3, 7, 45, ["The lift has no energy.", "Fill the machine, ride up and fix the bridge."])
    L.spawn(1, 0.6)
    L.ground(0, 0, 6)
    L.sign(3, 0, "Machines need energy. Fill them up!")
    L.windmill(9.5, 0, -2.6, 2.6)
    L.lift(14.3, 0.0, 4.0)
    L.energy(7, 0, 'Lift1', 2, 3, "Fill the machine to start the lift.", windmill='Windmill1')
    L.ground(17, 4, 6, 7)
    L.stone(17.5, 4); L.stone(19.0, 4); L.stone(24.0, 4); L.stone(25.5, 4)
    L.plat(21.5, 5.8, 1); L.gem(21.5, 5.8)
    L.bridge(27, 4, 6, 4, 2, 3, "Fix the bridge with your stones.")
    L.ground(34, 4, 4, 7)
    L.gate(40, 4, 'mixed', 2, 3, "Open the gate at the top.", show=False)
    L.ground(42, 2, 6, 5)
    L.plat(46, 3.8, 1); L.gem(46, 3.8)
    L.plat(4, 1.8, 1); L.gem(4, 1.8)
    L.goal(51, 2)
    L.kdecor([2, 6], 0, 131)
    L.kdecor([20, 23, 35], 4, 132)
    L.kdecor([44, 49], 2, 133)
    L.ndecor([1, 4], 0, 181)
    L.ndecor([18, 22, 34, 37], 4, 182)
    L.ndecor([45, 50], 2, 183)
    L.prop('kenney_forest/ladder', 33.4, 0.2, 1.3, 2.4, 0)
    L.prop('kenney_forest/stones', 9.5, 0, 1.9, 2.2, 30)
    L.trees([1, 5.5, 18.5, 23, 35, 44, 50], 0, 31)
    L.prop('hexagon/barrel', 9, 0, 1.6, 2.4)
    L.prop('hexagon/crate_A_big', 2, 0, 1.7, 2.4, 20)
    L.prop('hexagon/sack', 25.5, 4, -1.6, 2.4)
    L.rocks([37, 48], 0, 32)
    L.scenery(0, 54, 33)
    L.write()

def level5():
    L = Lvl('GuardianArena', 4, 7, 32, ["The Stone Guardian guards the island.", "When it gets tired, solve the crystal spells."])
    L.spawn(1, 0.6)
    L.ground(0, 0, 6)
    L.sign(2.5, 0, "Be brave! Rocks only bump you.")
    L.plat(5, 1.8, 1); L.gem(5, 1.8)
    L.ground(14, 0, 3)
    L.plat(15, 1.8, 1); L.gem(15, 1.8)
    L.ground(20, 0, 14, 3, 5)
    L.checkpoint(21.5, 0)
    L.gem(33, 2.6)
    L.boss(41, 0)
    L.goal(29, 0, hidden=True)
    L.kdecor([2, 7, 14, 17], 0, 141)
    L.ndecor([1, 9, 15], 0, 191)
    L.prop('kenney_forest/rocks-low', 23, 0, -3.2, 2.6, 15)
    L.prop('kenney_forest/rocks-low', 44, 0, -3.4, 2.8, 70)
    L.prop('dungeon/pillar', 19.5, 0, -2.8, 1.0)
    L.prop('dungeon/pillar', 45.5, 0, -2.8, 1.0)
    L.prop('dungeon/torch_lit', 19.5, 4.0, -2.0, 1.4)
    L.trees([1, 8, 14], 0, 41)
    L.rocks([24, 27, 36, 44], 0, 42, z=2.9)
    L.scenery(0, 48, 43)
    L.write()

def level6():
    L = Lvl('EqualGroupsTrail', 5, 7, 56, ["Welcome to Multiplication Mountains!", "Same-size piles are quick to count."])
    L.terrain = True
    L.spawn(1, 0.6)
    L.ground(0, 0, 10)
    L.sign(4, 0, "Count one pile, then count on.")
    L.plat(8, 1.8, 1); L.gem(8, 1.8)
    L.gate(17, 0, 'mul', 1, 1, "Count the piles. Open the gate!")
    L.ground(22, 0, 4)
    L.checkpoint(23, 0)
    L.ground(32, 1, 6, 4)
    L.plat(33, 2.8, 1); L.gem(33, 2.8)
    L.gate(41, 1, 'mul', 1, 2, "Open the mountain gate!")
    L.ground(46, 0, 8)
    L.plat(50, 1.8, 1); L.gem(50, 1.8)
    L.gate(54, 0, 'mul', 2, 2, "The last gate: think in groups!", show=False)
    L.goal(59, 0)
    L.mdecor([2, 6, 9, 21, 26, 28, 47, 52, 58], 0, 201)
    L.mdecor([31, 44], 1, 202)
    L.prop('hexagon/tent', 25.5, 0, -2.2, 2.2, -25)
    L.prop('hexagon/flag_green', 23.5, 0, -1.6, 2.2)
    L.krocks([5, 24, 48, 57], 0, 203)
    L.mscenery(0, 62, 204)
    L.write()

def level7():
    L = Lvl('CrystalSteps', 6, 7, 42, ["The cliffs are too tall to jump.", "Light the crystals to build the steps."])
    L.terrain = True
    L.spawn(1, 0.6)
    L.ground(0, 0, 7)
    L.sign(3, 0, "Each step needs the same number of crystals.")
    L.plat(6, 1.8, 1); L.gem(6, 1.8)
    L.steps(9, 0, 1, 2, "Build the crystal steps.")
    L.ground(15, 3.2, 6, 5)
    L.plat(15.5, 5.0, 1); L.gem(15.5, 5.0)
    L.gate(24, 3.2, 'mul', 2, 3, "Open the gate on the ledge.")
    L.ground(28, 3.2, 4, 5)
    L.steps(30, 3.2, 2, 3, "Build the steps to the top.")
    L.ground(36, 6.4, 6, 8)
    L.plat(40, 8.2, 1); L.gem(40, 8.2)
    L.goal(45, 6.4)
    L.mdecor([2, 5], 0, 211)
    L.mdecor([25.5], 3.2, 212)
    L.mdecor([38, 43, 46], 6.4, 213)
    L.prop('hexagon/flag_red', 46.5, 6.4, -1.6, 2.4)
    L.krocks([3], 0, 214)
    L.mscenery(0, 48, 215)
    L.write()

def level8():
    L = Lvl('SummitPath', 7, 7, 50, ["The summit is near!", "Use everything you have learned."])
    L.terrain = True
    L.spawn(1, 0.6)
    L.ground(0, 0, 6)
    L.sign(3, 0, "Adding, taking away and groups: you know them all!")
    L.stone(4, 0); L.stone(6.5, 0); L.stone(9, 0)
    L.plat(7, 1.8, 1); L.stone(7, 1.8)
    L.bridge(11, 0, 6, 4, 2, 3, "Fix the bridge with your stones.")
    L.ground(18, 0, 4)
    L.plat(19.5, 1.8, 1); L.gem(19.5, 1.8)
    L.steps(21, 0, 3, 4, "Climb the crystal steps.")
    L.ground(27, 3.2, 4, 5)
    L.plat(28, 5.0, 1); L.gem(28, 5.0)
    L.lift(37.3, 3.2, 3.2)
    L.energy(30.5, 3.2, 'Lift1', 3, 3, "Fill the machine to start the lift.")
    L.ground(40, 6.4, 8, 8)
    L.plat(42, 8.2, 1); L.gem(42, 8.2)
    L.gate(48, 6.4, 'mul', 3, 4, "Open the summit gate!")
    L.goal(53, 6.4)
    L.mdecor([2, 8, 19], 0, 221)
    L.mdecor([27, 32], 3.2, 222)
    L.mdecor([50, 54], 6.4, 223)
    L.prop('hexagon/flag_red', 54.5, 6.4, -1.6, 2.6)
    L.prop('hexagon/flag_green', 51.5, 6.4, -1.8, 2.4)
    L.prop('hexagon/building_tower_A_blue', 55.5, 6.4, -2.8, 2.4)
    L.krocks([5], 0, 224)
    L.mscenery(0, 56, 225)
    L.write()

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for f in sys.argv[1:] or ['level%d' % i for i in range(1, 9)]:
        globals()[f]()
