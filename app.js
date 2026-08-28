// ==========================================
// 🔒 OPERATOR CREDENTIALS & SESSION STORE
// ==========================================
const AUTHORIZED_USERS = {
    "rakesh_blast_lead": "BlastZone#Rakesh2026!",
    "razaq_hazmat_cmd": "Overpressure#Razaq2026!",
    "shreyas_safety_dir": "RefineryShield#Shreyas2026!"
};

let selectedChemical = "Propane";

function checkSessionOnLoad() {
    const token = sessionStorage.getItem('auth_token');
    const user = sessionStorage.getItem('auth_user');
    if (token && user) {
        document.getElementById('homePageContainer').style.display = 'none';
        document.getElementById('hudOverlay').style.display = 'block';
        document.getElementById('navLoginBtn').style.display = 'none';
        document.getElementById('navLogoutBtn').style.display = 'block';
        document.getElementById('operatorBadge').style.display = 'inline-block';
        document.getElementById('opName').innerText = user;
    } else {
        document.getElementById('homePageContainer').style.display = 'flex';
        document.getElementById('hudOverlay').style.display = 'none';
        document.getElementById('navLoginBtn').style.display = 'block';
        document.getElementById('navLogoutBtn').style.display = 'none';
        document.getElementById('operatorBadge').style.display = 'none';
    }
}

function openLoginModal() { document.getElementById('loginOverlay').style.display = 'flex'; }
function closeLoginModal() { document.getElementById('loginOverlay').style.display = 'none'; }

function handleLogin() {
    const u = document.getElementById('loginUser').value.trim();
    const p = document.getElementById('loginPass').value;
    if (AUTHORIZED_USERS[u] && AUTHORIZED_USERS[u] === p) {
        sessionStorage.setItem('auth_token', 'active_session_token');
        sessionStorage.setItem('auth_user', u);
        closeLoginModal();
        checkSessionOnLoad();
    } else {
        document.getElementById('loginError').style.display = 'block';
    }
}

function handleLogout() {
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_user');
    checkSessionOnLoad();
    reset3DView();
}

function selectChemical(chem, el) {
    selectedChemical = chem;
    document.querySelectorAll('.chem-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
}

const toggleHudBtn = document.getElementById('toggleHudBtn');
const hudContent = document.getElementById('hudContent');
let isMinimized = false;

toggleHudBtn.addEventListener('click', () => {
    isMinimized = !isMinimized;
    if (isMinimized) {
        hudContent.classList.add('minimized');
        toggleHudBtn.innerText = '+';
    } else {
        hudContent.classList.remove('minimized');
        toggleHudBtn.innerText = '−';
    }
});

// ==========================================
// 🌐 THREE.JS SCENE, LIGHTING & STRUCTURAL NODES
// ==========================================
let scene, camera, renderer, controls, plantGroup, pipeNetworkGroup, threatZoneGroup;
let allComponents = [];
let allPipelines = [];
let primaryFocusComponent = null;
let autoRotate = false, showLabels = true;

const container = document.getElementById('canvas-container');

function init3DScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060913);
    scene.fog = new THREE.FogExp2(0x060913, 0.003);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(55, 35, 65);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    // Orbit Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 10, 0);
    controls.maxPolarAngle = Math.PI / 2 - 0.02;

    // Lighting Setup
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));

    const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.4);
    sunLight.position.set(70, 110, 50);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 250;
    const d = 60;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0003;
    scene.add(sunLight);

    const skyLight = new THREE.DirectionalLight(0x38bdf8, 0.35);
    skyLight.position.set(-60, 40, -50);
    scene.add(skyLight);

    // Industrial Foundation
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9, metalness: 0.1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(240, 48, 0x0284c7, 0x1e293b);
    grid.position.y = 0.01;
    scene.add(grid);

    // Structural Groups
    plantGroup = new THREE.Group();
    scene.add(plantGroup);

    pipeNetworkGroup = new THREE.Group();
    scene.add(pipeNetworkGroup);

    threatZoneGroup = new THREE.Group();
    scene.add(threatZoneGroup);

    buildRealisticRefineryPlant();
    buildConnectedPipingNetwork();
    animate();
}

function registerComponent(mesh, name, unitKey, unitType) {
    mesh.material = mesh.material.clone();
    mesh.userData = { 
        partName: name, 
        unitKey: unitKey, 
        unitType: unitType, 
        originalColor: mesh.material.color.getHex(), 
        alertState: 'NORMAL' 
    };
    plantGroup.add(mesh);
    allComponents.push(mesh);
    return mesh;
}

let contactor, regenerator, reboiler, exchanger, surgeTank, flashDrum;

// ==========================================
// 🏭 3D EQUIPMENT NODES
// ==========================================
function buildRealisticRefineryPlant() {
    const matGalvanizedSteel = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.25 });
    const matCoatedWhite = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, metalness: 0.15, roughness: 0.3 });
    const matDarkVessel = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.75, roughness: 0.35 });
    const matBlueDrum = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.3, roughness: 0.3 });
    const matConcretePedestal = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.95 });

    function addPedestal(x, z, w, d, h = 1) {
        const ped = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matConcretePedestal);
        ped.position.set(x, h / 2, z);
        ped.receiveShadow = true;
        plantGroup.add(ped);
    }

    // 1. Amine Contactor Column (High-Pressure Absorber)
    addPedestal(-12, 0, 9, 9, 1.2);
    contactor = registerComponent(
        new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 26, 32), matCoatedWhite), 
        "Amine Contactor Column", "contactor", "vessel"
    );
    contactor.position.set(-12, 14.2, 0);
    contactor.castShadow = true; contactor.receiveShadow = true;

    for (let h = 4; h <= 24; h += 4) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(4.1, 4.1, 0.4, 32), matDarkVessel);
        ring.position.set(-12, h, 0);
        plantGroup.add(ring);
    }

    // 2. Regenerator (Stripper) Column
    addPedestal(8, 0, 8, 8, 1.2);
    regenerator = registerComponent(
        new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 22, 32), matGalvanizedSteel), 
        "Regenerator (Stripper) Column", "regenerator", "vessel"
    );
    regenerator.position.set(8, 12.2, 0);
    regenerator.castShadow = true; regenerator.receiveShadow = true;

    // 3. Reboiler Unit (Thermosiphon Kettle at base of Regenerator)
    addPedestal(8, 8, 6, 10, 0.8);
    reboiler = registerComponent(
        new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 8, 24), matDarkVessel), 
        "Reboiler Heating Unit", "reboiler", "thermal"
    );
    reboiler.rotation.z = Math.PI / 2;
    reboiler.position.set(8, 2.8, 8);
    reboiler.castShadow = true; reboiler.receiveShadow = true;

    // 4. Lean/Rich Heat Exchanger (Shell & Tube Pack)
    addPedestal(-2, 4, 8, 6, 0.8);
    exchanger = registerComponent(
        new THREE.Mesh(new THREE.BoxGeometry(6.5, 3.5, 4.5), matDarkVessel), 
        "Lean/Rich Heat Exchanger", "exchanger", "thermal"
    );
    exchanger.position.set(-2, 2.5, 4);
    exchanger.castShadow = true; exchanger.receiveShadow = true;

    // 5. Amine Surge & Storage Tank (Horizontal Vessel)
    addPedestal(-12, 9, 8, 7, 0.8);
    surgeTank = registerComponent(
        new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 7.5, 32), matCoatedWhite), 
        "Amine Surge Tank", "surge", "tank"
    );
    surgeTank.rotation.z = Math.PI / 2;
    surgeTank.position.set(-12, 3.4, 9);
    surgeTank.castShadow = true; surgeTank.receiveShadow = true;

    // 6. Flash Drum (Acid Gas Knockout)
    addPedestal(-2, -6, 6, 6, 0.8);
    flashDrum = registerComponent(
        new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 8.5, 32), matBlueDrum), 
        "Flash & Knockout Drum", "flash", "vessel"
    );
    flashDrum.position.set(-2, 5.0, -6);
    flashDrum.castShadow = true; flashDrum.receiveShadow = true;
}

// ==========================================
// 🔀 ACCURATE P&ID PIPELINE ROUTING NETWORK
// ==========================================
function buildConnectedPipingNetwork() {
    const matPipeSteel = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.2 });
    const matPipeOrange = new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: 0.6, roughness: 0.3 }); // Rich Gas
    const matPipeBlue = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.6, roughness: 0.3 });   // Lean Amine
    const matPipeYellow = new THREE.MeshStandardMaterial({ color: 0xeab308, metalness: 0.7, roughness: 0.25 }); // Vapor Recycle

    function createPipingSegment(points, pipeRadius = 0.35, material = matPipeSteel, flowType = "standard") {
        const curve = new THREE.CurvePath();
        for (let i = 0; i < points.length - 1; i++) {
            curve.add(new THREE.LineCurve3(points[i], points[i + 1]));
        }

        const tubeGeo = new THREE.TubeGeometry(curve, 64, pipeRadius, 16, false);
        const pipeMesh = new THREE.Mesh(tubeGeo, material);
        pipeMesh.castShadow = true;
        pipeNetworkGroup.add(pipeMesh);

        // Flange Rings at joints
        points.forEach((p, idx) => {
            if (idx > 0 && idx < points.length - 1) {
                const flange = new THREE.Mesh(new THREE.CylinderGeometry(pipeRadius * 1.6, pipeRadius * 1.6, 0.25, 16), matPipeSteel);
                flange.position.copy(p);
                pipeNetworkGroup.add(flange);
            }
        });

        allPipelines.push({ mesh: pipeMesh, originalColor: material.color.getHex(), type: flowType });
    }

    // Line 1: Rich Amine from Contactor Bottom to Flash Drum
    createPipingSegment([
        new THREE.Vector3(-12, 2.5, 0),
        new THREE.Vector3(-12, 1.2, -6),
        new THREE.Vector3(-4.2, 1.2, -6),
        new THREE.Vector3(-4.2, 3.0, -6)
    ], 0.4, matPipeOrange, "rich");

    // Line 2: Flash Drum Overhead to Lean/Rich Exchanger Tube Side
    createPipingSegment([
        new THREE.Vector3(-2, 1.5, -3.5),
        new THREE.Vector3(-2, 1.5, 1.5)
    ], 0.38, matPipeOrange, "rich");

    // Line 3: Rich Amine from Exchanger to Regenerator Top Inlet
    createPipingSegment([
        new THREE.Vector3(1.5, 3.5, 4),
        new THREE.Vector3(4.0, 3.5, 4),
        new THREE.Vector3(4.0, 18.0, 0),
        new THREE.Vector3(5.0, 18.0, 0)
    ], 0.35, matPipeOrange, "rich");

    // Line 4: Regenerator Bottoms to Reboiler Heating Unit Inlet
    createPipingSegment([
        new THREE.Vector3(8, 2.5, 2.5),
        new THREE.Vector3(8, 2.5, 4.0)
    ], 0.5, matPipeYellow, "thermal");

    // Line 5: Stripped Vapor Return from Reboiler back into Regenerator
    createPipingSegment([
        new THREE.Vector3(8, 4.0, 6.0),
        new THREE.Vector3(8, 5.5, 6.0),
        new THREE.Vector3(8, 5.5, 3.0)
    ], 0.45, matPipeYellow, "thermal");

    // Line 6: Hot Lean Amine from Reboiler Bottom through Exchanger Shell Side
    createPipingSegment([
        new THREE.Vector3(4.0, 2.0, 8),
        new THREE.Vector3(1.5, 2.0, 8),
        new THREE.Vector3(1.5, 2.0, 5.5)
    ], 0.4, matPipeBlue, "lean");

    // Line 7: Cooled Lean Amine from Exchanger to Amine Surge Tank
    createPipingSegment([
        new THREE.Vector3(-5.5, 2.0, 4),
        new THREE.Vector3(-9.0, 2.0, 4),
        new THREE.Vector3(-9.0, 2.0, 6.5)
    ], 0.38, matPipeBlue, "lean");

    // Line 8: Pumped Lean Amine from Surge Tank to Contactor Top Inlet
    createPipingSegment([
        new THREE.Vector3(-12, 5.0, 9),
        new THREE.Vector3(-12, 22.0, 9),
        new THREE.Vector3(-12, 22.0, 3.8)
    ], 0.4, matPipeBlue, "lean");
}

// ==========================================
// 💥 VOLUMETRIC BLAST OVERPRESSURE SPHERES
// ==========================================
function update3DThreatSpheres(originMesh, redRadius, yellowRadius, greenRadius) {
    while (threatZoneGroup.children.length > 0) {
        threatZoneGroup.remove(threatZoneGroup.children[0]);
    }

    const originPos = originMesh.position.clone();

    function createThreatSphere(radius, colorHex, opacityVal) {
        const sphereGeo = new THREE.SphereGeometry(radius, 36, 18);
        const sphereMat = new THREE.MeshBasicMaterial({ 
            color: colorHex, 
            transparent: true, 
            opacity: opacityVal, 
            wireframe: true 
        });
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        sphere.position.copy(originPos);
        threatZoneGroup.add(sphere);
    }

    createThreatSphere(redRadius, 0xef4444, 0.5);   // Red Lethal Zone
    createThreatSphere(yellowRadius, 0xf59e0b, 0.3); // Yellow Structural Zone
    createThreatSphere(greenRadius, 0x22c55e, 0.15); // Green Safe Boundary
}

// ==========================================
// 🚀 REAL-WORLD AUTONOMOUS FAILURE IDENTIFICATION & INTERLOCKS
// ==========================================
function runSimulation() {
    const flow = parseFloat(document.getElementById('chemQty').value) || 120;
    const press = parseFloat(document.getElementById('chemPress').value) || 850;
    const temp = parseFloat(document.getElementById('chemTemp').value) || 160;

    // Reset components to base states
    allComponents.forEach(c => {
        c.userData.alertState = 'NORMAL';
        c.material.color.setHex(c.userData.originalColor);
    });

    const statusBadge = document.getElementById('processStatusBadge');
    const descEl = document.getElementById('processDesc');
    const broadcastBtn = document.getElementById('broadcastActionBtn');
    const metricsDiv = document.getElementById('blastMetrics');
    const breachLabel = document.getElementById('resBreachNode');

    // Autonomous Root-Cause Node Detection based on Thermodynamics:
    // Reboiler undergoes maximum thermal expansion strain; Exchanger suffers differential pressure rupture.
    let rootBreachUnit = null;
    let failureMechanism = "";

    if (temp > 200) {
        rootBreachUnit = reboiler;
        failureMechanism = "Severe reboiler tube thermal expansion & vapor containment burst";
    } else if (press > 1000) {
        rootBreachUnit = exchanger;
        failureMechanism = "High-pressure gasket breach & rich amine hydrocarbon seal failure";
    } else if (flow > 250) {
        rootBreachUnit = contactor;
        failureMechanism = "Absorber hydraulic flood surging & gas blowby";
    } else if (temp > 150) {
        rootBreachUnit = reboiler;
        failureMechanism = "Elevated heat duty inducing mechanical fatigue";
    } else if (press > 750) {
        rootBreachUnit = exchanger;
        failureMechanism = "Differential pressure stress along exchanger flange manifold";
    } else {
        rootBreachUnit = null;
    }

    // Standard Industrial TNT Equivalence Scaling
    const tntFactors = { "Propane": 0.5, "Methane": 0.4, "Hydrogen": 1.5, "Gasoline": 0.45 };
    const massKg = flow * 40.0; // Scaled operational fuel inventory from flow throughput
    const eqTNT = massKg * (tntFactors[selectedChemical] || 0.45);

    const red_m = Math.round(10.0 * Math.cbrt(eqTNT));
    const yellow_m = Math.round(red_m * 1.8);
    const green_m = Math.round(red_m * 2.8);
    const scale3D = 0.28;

    // Telemetry Diagnostics Evaluation
    if (press > 1000 || temp > 200 || flow > 250) {
        statusBadge.innerText = "CRITICAL ESD INITIATED 🚨";
        statusBadge.className = "status-badge status-critical";

        rootBreachUnit.userData.alertState = 'CRITICAL';
        if (rootBreachUnit === reboiler) exchanger.userData.alertState = 'CRITICAL';
        primaryFocusComponent = rootBreachUnit;

        descEl.innerHTML = `🚨 <strong>CRITICAL TIER (${press} psi, ${temp}&deg;F, ${flow} MMSCFD):</strong> Autonomous logic detected ${failureMechanism} at <strong>${rootBreachUnit.userData.partName}</strong>. Emergency Safety Shutdown (ESD) executed, automated blowdown initiated, and process feeds isolated.`;
        
        metricsDiv.style.display = 'block';
        breachLabel.innerText = rootBreachUnit.userData.partName;
        document.getElementById('resTNT').innerText = Math.round(eqTNT);
        document.getElementById('resRed').innerText = red_m;
        document.getElementById('resYellow').innerText = yellow_m;
        document.getElementById('resGreen').innerText = green_m;
        broadcastBtn.style.display = 'block';

        update3DThreatSpheres(rootBreachUnit, red_m * scale3D, yellow_m * scale3D, green_m * scale3D);

    } else if (press > 750 || temp > 150 || flow > 180) {
        statusBadge.innerText = "WARNING: THERMAL STRAIN ⚠️";
        statusBadge.className = "status-badge status-warning";

        rootBreachUnit.userData.alertState = 'WARNING';
        primaryFocusComponent = rootBreachUnit;

        descEl.innerHTML = `⚠️ <strong>WARNING TIER:</strong> Continuous telemetry detects ${failureMechanism} at <strong>${rootBreachUnit.userData.partName}</strong>. Automatic rate reduction & heat duty modulation recommended.`;
        
        metricsDiv.style.display = 'block';
        breachLabel.innerText = `${rootBreachUnit.userData.partName} (Strain Warning)`;
        document.getElementById('resTNT').innerText = Math.round(eqTNT);
        document.getElementById('resRed').innerText = red_m;
        document.getElementById('resYellow').innerText = yellow_m;
        document.getElementById('resGreen').innerText = green_m;
        broadcastBtn.style.display = 'block';

        update3DThreatSpheres(rootBreachUnit, red_m * scale3D, yellow_m * scale3D, green_m * scale3D);

    } else {
        statusBadge.innerText = "NOMINAL PROCESS STATE ✅";
        statusBadge.className = "status-badge status-normal";
        primaryFocusComponent = null;
        descEl.innerHTML = `✅ All equipment units and interconnected piping networks are operating safely within design tolerances.`;
        metricsDiv.style.display = 'none';
        broadcastBtn.style.display = 'none';

        while (threatZoneGroup.children.length > 0) {
            threatZoneGroup.remove(threatZoneGroup.children[0]);
        }
    }
}

function triggerEmergencyBroadcast() {
    const btn = document.getElementById('broadcastActionBtn');
    btn.innerHTML = "✅ Safety Interlocks & ESD Signals Broadcasted to Hazmat Command";
    btn.classList.remove('pulsing');
    btn.disabled = true;
}

// ==========================================
// 🎮 CAMERA & VIEWPORT CONTROLS
// ==========================================
function adjustCameraZoom(delta) {
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    camera.position.addScaledVector(dir, delta);
}

function focusCriticalUnit() {
    if (!primaryFocusComponent) return;
    const center = new THREE.Vector3();
    new THREE.Box3().setFromObject(primaryFocusComponent).getCenter(center);
    controls.target.copy(center);
    camera.position.set(center.x + 18, center.y + 12, center.z + 18);
}

function reset3DView() {
    controls.target.set(0, 10, 0);
    camera.position.set(55, 35, 65);
    while (threatZoneGroup.children.length > 0) threatZoneGroup.remove(threatZoneGroup.children[0]);
    document.getElementById('blastMetrics').style.display = 'none';
    document.getElementById('processStatusBadge').className = 'status-badge status-normal';
    document.getElementById('processStatusBadge').innerText = 'Nominal';
    document.getElementById('processDesc').innerText = 'All facility units and connected piping lines are operating within structural design limits.';
    document.getElementById('broadcastActionBtn').style.display = 'none';
    allComponents.forEach(c => {
        c.userData.alertState = 'NORMAL';
        c.material.color.setHex(c.userData.originalColor);
    });
}

function toggleAutoRotate() {
    autoRotate = !autoRotate;
    document.getElementById('btnAutoRotate').style.background = autoRotate ? '#0284c7' : '#1e293b';
}

function toggleLabels() {
    showLabels = !showLabels;
    updateLabels();
}

const labelObjects = [
    { id: 'label-contactor', pos: new THREE.Vector3(-12, 28, 0) },
    { id: 'label-regenerator', pos: new THREE.Vector3(8, 24, 0) },
    { id: 'label-reboiler', pos: new THREE.Vector3(8, 5, 8) },
    { id: 'label-exchanger', pos: new THREE.Vector3(-2, 5.5, 4) },
    { id: 'label-surge', pos: new THREE.Vector3(-12, 7, 9) },
    { id: 'label-flash', pos: new THREE.Vector3(-2, 10.5, -6) }
];

function updateLabels() {
    const widthHalf = window.innerWidth / 2;
    const heightHalf = window.innerHeight / 2;
    labelObjects.forEach(item => {
        const el = document.getElementById(item.id);
        if (!showLabels || sessionStorage.getItem('auth_token') === null) {
            el.style.display = 'none';
            return;
        }
        const tempVec = item.pos.clone().project(camera);
        if (tempVec.z < 1) {
            el.style.left = `${(tempVec.x * widthHalf) + widthHalf}px`;
            el.style.top = `${-(tempVec.y * heightHalf) + heightHalf}px`;
            el.style.display = 'block';
        } else {
            el.style.display = 'none';
        }
    });
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ==========================================
// 🔄 RENDER LOOP WITH SINUSOIDAL BLINK
// ==========================================
function animate() {
    requestAnimationFrame(animate);

    if (autoRotate) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 1.0;
    } else {
        controls.autoRotate = false;
    }
    controls.update();

    const time = Date.now() * 0.01;

    // Sinusoidal mesh color interpolation on alert components
    allComponents.forEach(c => {
        const orig = new THREE.Color(c.userData.originalColor);
        if (c.userData.alertState === 'CRITICAL') {
            const blink = (Math.sin(time) + 1) * 0.5;
            c.material.color.lerpColors(orig, new THREE.Color(0xdc2626), blink);
        } else if (c.userData.alertState === 'WARNING') {
            const blink = (Math.sin(time * 0.7) + 1) * 0.5;
            c.material.color.lerpColors(orig, new THREE.Color(0xf59e0b), blink);
        }
    });

    // Slow rotation of blast spheres
    threatZoneGroup.rotation.y += 0.002;

    renderer.render(scene, camera);
    updateLabels();
}

window.onload = () => {
    init3DScene();
    checkSessionOnLoad();
};