const AUTHORIZED_USERS = {
    "rakesh": "2026",
    "razaq": "2026",
    "shreyas": "2026"
};

let selectedChemical = "Propane";
let workflowStage = 0;

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
    if (selectedChemical === chem) return;
    selectedChemical = chem;
    document.querySelectorAll('.chem-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    
    document.getElementById('chemQty').value = '';
    document.getElementById('chemPress').value = '';
    document.getElementById('chemTemp').value = '';

    workflowStage = 0;
    closePdfModal();
    rebuildFacilityForChemical(chem);
}

let isMinimized = false;
document.addEventListener('DOMContentLoaded', () => {
    const toggleHudBtn = document.getElementById('toggleHudBtn');
    const hudContent = document.getElementById('hudContent');
    if (toggleHudBtn && hudContent) {
        toggleHudBtn.addEventListener('click', () => {
            isMinimized = !isMinimized;
            hudContent.classList.toggle('minimized', isMinimized);
            toggleHudBtn.innerText = isMinimized ? '+' : '−';
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const loginOverlay = document.getElementById('loginOverlay');
            if (loginOverlay && loginOverlay.style.display === 'flex') {
                handleLogin();
                return;
            }

            const pdfOverlay = document.getElementById('pdfModalOverlay');
            if (pdfOverlay && pdfOverlay.style.display === 'flex') return;

            const homePage = document.getElementById('homePageContainer');
            if (homePage && homePage.style.display !== 'none') return;

            if (workflowStage === 0) {
                runSimulation();
            } else if (workflowStage === 1) {
                triggerEmergencyBroadcast();
            } else if (workflowStage === 2) {
                previewSafetyReport();
            }
        }
    });
});

// ------------------------------------------
// 🌐 THREE.SCENE, LIGHTING, CONTROLS & ENVIRONMENT
// ------------------------------------------
let scene, camera, renderer, controls, plantGroup, pipeNetworkGroup, natureGroup;
let ambientLightRef, sunLightRef, skyLightRef, nightFloodlightsGroup;
let composer, bloomPass;
let fpControls, isFpsMode = false;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

let allComponents = [];
let allPipelines = [];
let primaryFocusComponent = null;
let finalProductStorageTank = null;
let autoRotate = false, showLabels = true;
let labelObjects = [];

let isCameraTransitioning = false;
let targetCameraPos = new THREE.Vector3();
let targetControlsTarget = new THREE.Vector3();

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function init3DScene() {
    const container = document.getElementById('canvas-container');
    if (!container) return;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x7dd3fc);
    scene.fog = new THREE.FogExp2(0xbae6fd, 0.0018);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(65, 40, 75);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 5, 0);
    controls.maxPolarAngle = Math.PI / 2 - 0.01;

    const renderScene = new THREE.RenderPass(scene, camera);
    bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.75, 0.4, 0.85
    );
    composer = new THREE.EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);

    initFPSControls();

    // Natural Outdoor Lighting References
    ambientLightRef = new THREE.AmbientLight(0xd9f99d, 0.6);
    scene.add(ambientLightRef);

    sunLightRef = new THREE.DirectionalLight(0xfffbeb, 1.6);
    sunLightRef.position.set(100, 140, 80);
    sunLightRef.castShadow = true;
    sunLightRef.shadow.mapSize.width = 2048;
    sunLightRef.shadow.mapSize.height = 2048;
    sunLightRef.shadow.camera.near = 10;
    sunLightRef.shadow.camera.far = 400;
    const d = 90;
    sunLightRef.shadow.camera.left = -d;
    sunLightRef.shadow.camera.right = d;
    sunLightRef.shadow.camera.top = d;
    sunLightRef.shadow.camera.bottom = -d;
    sunLightRef.shadow.bias = -0.0003;
    scene.add(sunLightRef);

    skyLightRef = new THREE.DirectionalLight(0x38bdf8, 0.4);
    skyLightRef.position.set(-80, 60, -70);
    scene.add(skyLightRef);

    buildNaturalEnvironment();

    plantGroup = new THREE.Group();
    scene.add(plantGroup);

    pipeNetworkGroup = new THREE.Group();
    scene.add(pipeNetworkGroup);

    window.addEventListener('pointerdown', handleCanvasClick);

    buildPropaneFacility();
    animate();
}

function buildNaturalEnvironment() {
    natureGroup = new THREE.Group();
    scene.add(natureGroup);

    // Natural Grassy Ground
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x3f6212, roughness: 0.85, metalness: 0.05 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    natureGroup.add(ground);

    // Concrete Facility Pad
    const padMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.7, metalness: 0.2 });
    const pad = new THREE.Mesh(new THREE.BoxGeometry(90, 0.2, 90), padMat);
    pad.position.set(0, 0.05, 0);
    pad.receiveShadow = true;
    natureGroup.add(pad);

    // Perimeter Earth Hills
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x365314, roughness: 0.9 });
    for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        const radius = 130 + Math.random() * 30;
        const hx = Math.cos(angle) * radius;
        const hz = Math.sin(angle) * radius;
        
        const hill = new THREE.Mesh(new THREE.ConeGeometry(35 + Math.random() * 20, 18 + Math.random() * 12, 6), hillMat);
        hill.position.set(hx, 6, hz);
        hill.castShadow = true;
        hill.receiveShadow = true;
        natureGroup.add(hill);
    }

    // Perimeter Trees
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.7 });

    for (let i = 0; i < 70; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 55 + Math.random() * 75;
        const tx = Math.cos(angle) * distance;
        const tz = Math.sin(angle) * distance;

        const treeGroup = new THREE.Group();
        const trunkHeight = 3 + Math.random() * 3;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, trunkHeight, 6), trunkMat);
        trunk.position.y = trunkHeight / 2;
        trunk.castShadow = true;
        treeGroup.add(trunk);

        const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(2.5 + Math.random() * 2), leavesMat);
        crown.position.y = trunkHeight + 1.5;
        crown.castShadow = true;
        treeGroup.add(crown);

        treeGroup.position.set(tx, 0, tz);
        natureGroup.add(treeGroup);
    }

    // Night Floodlights Group (Hidden during day, glowing at night)
    nightFloodlightsGroup = new THREE.Group();
    scene.add(nightFloodlightsGroup);

    for (let xPos of [-30, 30]) {
        for (let zPos of [-30, 30]) {
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 18, 8), new THREE.MeshStandardMaterial({color: 0x334155, metalness: 0.8}));
            pole.position.set(xPos, 9, zPos);
            nightFloodlightsGroup.add(pole);

            const bulbLight = new THREE.PointLight(0xfef08a, 0, 45);
            bulbLight.position.set(xPos, 17.5, zPos);
            nightFloodlightsGroup.add(bulbLight);
        }
    }
}

// ------------------------------------------
// ☀️ DAY / NIGHT CYCLE SLIDER
// ------------------------------------------
function updateDayNightCycle(val) {
    const t = val / 100; // 0 = Midnight, 1 = Full Noon
    if (!scene || !sunLightRef || !ambientLightRef) return;

    // Interpolate Sky & Fog
    const nightSky = new THREE.Color(0x020617);
    const daySky = new THREE.Color(0x7dd3fc);
    scene.background.lerpColors(nightSky, daySky, t);
    scene.fog.color.lerpColors(new THREE.Color(0x0f172a), new THREE.Color(0xbae6fd), t);

    // Sunlight
    sunLightRef.intensity = t * 1.8;
    sunLightRef.position.set(100 * t - 50, Math.max(10, 140 * t), 80 * t);

    // Ambient Fill
    ambientLightRef.intensity = 0.15 + (t * 0.45);
    skyLightRef.intensity = t * 0.4;

    // Night Floodlights Glow Activation when slider is low (nighttime)
    const nightFactor = 1.0 - t;
    if (nightFloodlightsGroup) {
        nightFloodlightsGroup.children.forEach(child => {
            if (child.isPointLight) {
                child.intensity = nightFactor * 3.5;
            }
        });
    }

    renderer.toneMappingExposure = 0.85 + (t * 0.35);
}

function handleCanvasClick(event) {
    if (isFpsMode) return;
    if (event.target.closest('.hud-overlay') || event.target.closest('header') || event.target.closest('.controls')) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(allComponents, true);

    const tooltip = document.getElementById('sensorTooltip');

    if (intersects.length > 0) {
        let hitObj = intersects[0].object;
        while (hitObj.parent && !hitObj.userData.unitKey && hitObj.parent !== scene) {
            hitObj = hitObj.parent;
        }

        if (hitObj.userData && hitObj.userData.unitKey) {
            document.getElementById('tooltipTitle').innerText = `Tag: ${hitObj.userData.partName}`;
            const isCrit = hitObj.userData.alertState === 'CRITICAL';
            const isWarn = hitObj.userData.alertState === 'WARNING';
            
            let statusText = "Safe SOE ✅";
            let statusColor = "#4ade80";
            if (isCrit) { statusText = "CRITICAL BREACH 🚨"; statusColor = "#f87171"; }
            else if (isWarn) { statusText = "TRANSIENT STRAIN ⚠️"; statusColor = "#fde047"; }

            document.getElementById('tooltipStatus').innerText = statusText;
            document.getElementById('tooltipStatus').style.color = statusColor;
            
            document.getElementById('tooltipPress').innerText = document.getElementById('chemPress').value || '850 (Nominal)';
            document.getElementById('tooltipTemp').innerText = document.getElementById('chemTemp').value || '160 (Nominal)';

            tooltip.style.left = `${Math.min(window.innerWidth - 250, event.clientX + 15)}px`;
            tooltip.style.top = `${Math.min(window.innerHeight - 150, event.clientY + 15)}px`;
            tooltip.style.display = 'block';
            return;
        }
    }
    
    tooltip.style.display = 'none';
}

function cinematicCameraSweep(targetObject) {
    if (!targetObject || !controls || !camera) return;
    const center = new THREE.Vector3();
    new THREE.Box3().setFromObject(targetObject).getCenter(center);

    targetControlsTarget.copy(center);
    targetCameraPos.set(center.x + 18, center.y + 12, center.z + 18);

    isCameraTransitioning = true;
    autoRotate = true;
    document.getElementById('btnAutoRotate').style.background = '#0284c7';
}

function initFPSControls() {
    fpControls = new THREE.PointerLockControls(camera, document.body);

    fpControls.addEventListener('lock', () => {
        isFpsMode = true;
        controls.enabled = false;
        document.getElementById('fpsOverlay').style.display = 'block';
        document.getElementById('btnFPS').style.background = '#0284c7';
        document.getElementById('sensorTooltip').style.display = 'none';
    });

    fpControls.addEventListener('unlock', () => {
        isFpsMode = false;
        controls.enabled = true;
        document.getElementById('fpsOverlay').style.display = 'none';
        document.getElementById('btnFPS').style.background = '#1e293b';
    });

    document.addEventListener('keydown', (e) => {
        switch (e.code) {
            case 'KeyW': case 'ArrowUp': moveForward = true; break;
            case 'KeyA': case 'ArrowLeft': moveLeft = true; break;
            case 'KeyS': case 'ArrowDown': moveBackward = true; break;
            case 'KeyD': case 'ArrowRight': moveRight = true; break;
        }
    });

    document.addEventListener('keyup', (e) => {
        switch (e.code) {
            case 'KeyW': case 'ArrowUp': moveForward = false; break;
            case 'KeyA': case 'ArrowLeft': moveLeft = false; break;
            case 'KeyS': case 'ArrowDown': moveBackward = false; break;
            case 'KeyD': case 'ArrowRight': moveRight = false; break;
        }
    });
}

function toggleFPSMode() {
    if (!fpControls) return;
    if (!isFpsMode) {
        camera.position.set(0, 2.8, 45);
        camera.lookAt(0, 5, 0);
        fpControls.lock();
    } else {
        fpControls.unlock();
    }
}

function updateFPSMovement() {
    if (!isFpsMode || !fpControls.isLocked) return;

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    velocity.x -= velocity.x * 10.0 * delta;
    velocity.z -= velocity.z * 10.0 * delta;

    direction.z = Number(moveForward) - Number(moveBackward);
    direction.x = Number(moveRight) - Number(moveLeft);
    direction.normalize();

    if (moveForward || moveBackward) velocity.z -= direction.z * 120.0 * delta;
    if (moveLeft || moveRight) velocity.x -= direction.x * 120.0 * delta;

    fpControls.moveRight(-velocity.x * delta);
    fpControls.moveForward(-velocity.z * delta);

    camera.position.y = 2.8;
    prevTime = time;
}

// ------------------------------------------
// 🔥 DYNAMIC LEAK PARTICLE SYSTEM
// ------------------------------------------
let particleSystem = null, particleGeo = null;
let particleVelocities = [], particleLifes = [];
let isLiquidStream = false;

function createLeakParticles(originPos, isCritical = true, liquidType = false) {
    clearParticles();
    isLiquidStream = liquidType;

    const particleCount = isLiquidStream ? 220 : 180;
    particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    particleVelocities = [];
    particleLifes = [];

    const baseColor1 = isLiquidStream 
        ? new THREE.Color(0x111827) 
        : (isCritical ? new THREE.Color(0xef4444) : new THREE.Color(0xf59e0b));
        
    const baseColor2 = isLiquidStream 
        ? new THREE.Color(0x451a03) 
        : new THREE.Color(0x1e293b);

    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = originPos.x + (Math.random() - 0.5) * 1.2;
        positions[i * 3 + 1] = originPos.y + (Math.random() - 0.5) * 1.2;
        positions[i * 3 + 2] = originPos.z + (Math.random() - 0.5) * 1.2;

        const mixColor = baseColor1.clone().lerp(baseColor2, Math.random());
        colors[i * 3] = mixColor.r;
        colors[i * 3 + 1] = mixColor.g;
        colors[i * 3 + 2] = mixColor.b;

        if (isLiquidStream) {
            particleVelocities.push(new THREE.Vector3(
                (Math.random() - 0.5) * 0.28,
                -Math.random() * 0.25 - 0.15,
                (Math.random() - 0.5) * 0.28
            ));
        } else {
            particleVelocities.push(new THREE.Vector3(
                (Math.random() - 0.5) * 0.12,
                Math.random() * 0.22 + 0.08,
                (Math.random() - 0.5) * 0.12
            ));
        }

        particleLifes.push(Math.random());
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const pMaterial = new THREE.PointsMaterial({
        size: isLiquidStream ? 1.8 : 1.4,
        vertexColors: true,
        transparent: true,
        opacity: isLiquidStream ? 0.95 : 0.85,
        blending: isLiquidStream ? THREE.NormalBlending : THREE.AdditiveBlending
    });

    particleSystem = new THREE.Points(particleGeo, pMaterial);
    scene.add(particleSystem);
}

function updateParticles() {
    if (!particleSystem || !primaryFocusComponent) return;
    const positions = particleGeo.attributes.position.array;
    const count = positions.length / 3;
    const origin = primaryFocusComponent.position;

    for (let i = 0; i < count; i++) {
        positions[i * 3] += particleVelocities[i].x;
        positions[i * 3 + 1] += particleVelocities[i].y;
        positions[i * 3 + 2] += particleVelocities[i].z;

        if (isLiquidStream) {
            particleVelocities[i].y -= 0.008; 
            if (positions[i * 3 + 1] <= 0.2) {
                positions[i * 3] = origin.x + (Math.random() - 0.5) * 1.0;
                positions[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 1.0;
                positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 1.0;
                particleVelocities[i].y = -Math.random() * 0.25 - 0.15;
            }
        }

        particleLifes[i] -= 0.015;
        if (particleLifes[i] <= 0) {
            positions[i * 3] = origin.x + (Math.random() - 0.5) * 1.0;
            positions[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 1.0;
            positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 1.0;
            particleLifes[i] = 1.0;
            if (isLiquidStream) particleVelocities[i].y = -Math.random() * 0.25 - 0.15;
        }
    }
    particleGeo.attributes.position.needsUpdate = true;
}

function clearParticles() {
    if (particleSystem) {
        scene.remove(particleSystem);
        if (particleGeo) particleGeo.dispose();
        particleSystem = null;
    }
}

// ------------------------------------------
// 🏭 FACILITY GENERATION & PIPELINES
// ------------------------------------------
function disposeGroup(group) {
    while (group.children.length > 0) {
        const obj = group.children[0];
        group.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
            else obj.material.dispose();
        }
    }
}

function clearCurrentFacility() {
    allComponents = [];
    allPipelines = [];
    labelObjects = [];
    primaryFocusComponent = null;
    finalProductStorageTank = null;
    clearParticles();
    isCameraTransitioning = false;

    document.getElementById('sensorTooltip').style.display = 'none';
    document.getElementById('defectSensorTag').style.display = 'none';
    
    disposeGroup(plantGroup);
    disposeGroup(pipeNetworkGroup);

    const labelsContainer = document.getElementById('labels-container');
    if (labelsContainer) labelsContainer.innerHTML = '';
}

function registerComponent(mesh, name, unitKey, unitType, labelPos, isStorageTank = false) {
    mesh.material = mesh.material.clone();
    mesh.userData = { 
        partName: name, 
        unitKey: unitKey, 
        unitType: unitType, 
        originalColor: mesh.material.color.getHex(), 
        alertState: 'NORMAL',
        isStorage: isStorageTank
    };
    plantGroup.add(mesh);
    allComponents.push(mesh);

    if (isStorageTank) {
        finalProductStorageTank = mesh;
    }

    const labelId = `label-${unitKey}`;
    const labelEl = document.createElement('div');
    labelEl.id = labelId;
    labelEl.className = 'plant-label';
    labelEl.innerText = name;
    document.getElementById('labels-container').appendChild(labelEl);

    labelObjects.push({ id: labelId, pos: labelPos || mesh.position.clone().add(new THREE.Vector3(0, 5, 0)) });
    return mesh;
}

function createFlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 16);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, 64, 16);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

function createPipingSegment(points, pipeRadius = 0.35, materialColor = 0x94a3b8, flowType = "standard") {
    const curve = new THREE.CurvePath();
    for (let i = 0; i < points.length - 1; i++) {
        curve.add(new THREE.LineCurve3(points[i], points[i + 1]));
    }

    const pipeLength = curve.getLength();
    const flowTexture = createFlowTexture();
    flowTexture.repeat.set(Math.max(1, Math.round(pipeLength * 0.4)), 1);

    let flowSpeed = 0.008;
    if (flowType.includes("hot") || flowType.includes("syngas")) flowSpeed = 0.015;
    if (flowType.includes("cryo") || flowType.includes("lean")) flowSpeed = 0.004;

    const mat = new THREE.MeshStandardMaterial({ 
        color: materialColor, 
        metalness: 0.65, 
        roughness: 0.25,
        map: flowTexture
    });

    const tubeGeo = new THREE.TubeGeometry(curve, Math.max(32, Math.round(pipeLength * 2)), pipeRadius, 16, false);
    const pipeMesh = new THREE.Mesh(tubeGeo, mat);
    pipeMesh.castShadow = true;
    pipeNetworkGroup.add(pipeMesh);

    const flangeMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });
    points.forEach((p, idx) => {
        if (idx > 0 && idx < points.length - 1) {
            const flange = new THREE.Mesh(new THREE.CylinderGeometry(pipeRadius * 1.5, pipeRadius * 1.5, 0.2, 16), flangeMat);
            flange.position.copy(p);
            pipeNetworkGroup.add(flange);
        }
    });

    allPipelines.push({ mesh: pipeMesh, texture: flowTexture, speed: flowSpeed, originalColor: materialColor, type: flowType });
}

function addPedestal(x, z, w, d, h = 1.2) {
    const matConcrete = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.85 });
    const ped = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matConcrete);
    ped.position.set(x, h / 2, z);
    ped.receiveShadow = true;
    plantGroup.add(ped);
}

// 1. PROPANE FACILITY
let propContactor, propRegenerator, propReboiler, propExchanger, propSurge, propFlash;
function buildPropaneFacility() {
    clearCurrentFacility();
    const matCoatedWhite = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, metalness: 0.2, roughness: 0.3 });
    const matGalvanized = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.2 });
    const matDarkVessel = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.75, roughness: 0.35 });
    const matBlueDrum = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.3, roughness: 0.3 });
    const matProductTank = new THREE.MeshStandardMaterial({ color: 0x14532d, metalness: 0.5, roughness: 0.3 });

    addPedestal(-14, 0, 10, 10);
    propContactor = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 26, 32), matCoatedWhite), "Amine Contactor Column", "contactor", "vessel", new THREE.Vector3(-14, 29, 0));
    propContactor.position.set(-14, 14.2, 0);

    for (let h = 4; h <= 24; h += 4) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(4.0, 4.0, 0.4, 32), matDarkVessel);
        ring.position.set(-14, h, 0);
        plantGroup.add(ring);
    }

    addPedestal(8, 0, 9, 9);
    propRegenerator = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 22, 32), matGalvanized), "Regenerator Stripper Column", "regenerator", "vessel", new THREE.Vector3(8, 25, 0));
    propRegenerator.position.set(8, 12.2, 0);

    addPedestal(8, 9, 7, 10, 0.8);
    propReboiler = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 8.5, 32), matDarkVessel), "Reboiler Heating Unit", "reboiler", "thermal", new THREE.Vector3(8, 6, 9));
    propReboiler.rotation.z = Math.PI / 2;
    propReboiler.position.set(8, 3.0, 9);

    addPedestal(-3, 4, 8, 6, 0.8);
    propExchanger = registerComponent(new THREE.Mesh(new THREE.BoxGeometry(7.0, 3.6, 4.5), matDarkVessel), "Lean/Rich Heat Exchanger", "exchanger", "thermal", new THREE.Vector3(-3, 6.5, 4));
    propExchanger.position.set(-3, 2.6, 4);

    addPedestal(-14, 10, 9, 8, 0.8);
    propSurge = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 8.0, 32), matCoatedWhite), "Amine Surge Tank", "surge", "tank", new THREE.Vector3(-14, 7, 10));
    propSurge.rotation.z = Math.PI / 2;
    propSurge.position.set(-14, 3.5, 10);

    addPedestal(-3, -7, 7, 7, 0.8);
    propFlash = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 9.0, 32), matBlueDrum), "Flash & Knockout Drum", "flash", "vessel", new THREE.Vector3(-3, 11, -7));
    propFlash.position.set(-3, 5.3, -7);

    addPedestal(18, -8, 10, 10);
    registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 12.0, 32), matProductTank), "Sweetened LPG Final Product Storage Tank", "propStorage", "tank", new THREE.Vector3(18, 14, -8), true);
    finalProductStorageTank.position.set(18, 6.8, -8);

    createPipingSegment([ new THREE.Vector3(-14, 2.5, 0), new THREE.Vector3(-14, 1.2, -7), new THREE.Vector3(-5.4, 1.2, -7), new THREE.Vector3(-5.4, 3.0, -7) ], 0.4, 0xf97316, "rich");
    createPipingSegment([ new THREE.Vector3(-3, 1.5, -4.5), new THREE.Vector3(-3, 1.5, 1.7) ], 0.38, 0xf97316, "rich");
    createPipingSegment([ new THREE.Vector3(0.5, 3.5, 4), new THREE.Vector3(4.0, 3.5, 4), new THREE.Vector3(4.0, 18.0, 0), new THREE.Vector3(5.0, 18.0, 0) ], 0.38, 0xf97316, "rich");
    createPipingSegment([ new THREE.Vector3(8, 2.5, 2.8), new THREE.Vector3(8, 2.5, 4.8) ], 0.5, 0xeab308, "thermal");
    createPipingSegment([ new THREE.Vector3(8, 4.2, 7.0), new THREE.Vector3(8, 6.0, 7.0), new THREE.Vector3(8, 6.0, 3.0) ], 0.45, 0xeab308, "thermal");
    createPipingSegment([ new THREE.Vector3(4.0, 2.0, 9), new THREE.Vector3(0.5, 2.0, 9), new THREE.Vector3(0.5, 2.0, 5.5) ], 0.4, 0x38bdf8, "lean");
    createPipingSegment([ new THREE.Vector3(-6.5, 2.0, 4), new THREE.Vector3(-10.0, 2.0, 4), new THREE.Vector3(-10.0, 2.0, 7.5) ], 0.38, 0x38bdf8, "lean");
    createPipingSegment([ new THREE.Vector3(-14, 5.2, 10), new THREE.Vector3(-14, 23.0, 10), new THREE.Vector3(-14, 23.0, 3.8) ], 0.4, 0x38bdf8, "lean");
    createPipingSegment([ new THREE.Vector3(-10.5, 27, 0), new THREE.Vector3(4.0, 27, 0), new THREE.Vector3(18.0, 12, -8) ], 0.45, 0x22c55e, "product_output");
}

// 2. METHANE FACILITY
let lngScrubColumn, lngMainHeatEx, lngColdSurge, lngRefrigCompressor;
function buildMethaneFacility() {
    clearCurrentFacility();
    const matStainless = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.15 });
    const matInsulatedBlue = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.4, roughness: 0.3 });
    const matDarkCompressor = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.4 });
    const matProductTank = new THREE.MeshStandardMaterial({ color: 0x14532d, metalness: 0.5, roughness: 0.3 });

    addPedestal(-12, -2, 9, 9);
    lngScrubColumn = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 28, 32), matStainless), "Methane Scrub Tower", "lngScrub", "vessel", new THREE.Vector3(-12, 31, -2));
    lngScrubColumn.position.set(-12, 15.2, -2);

    addPedestal(0, 0, 12, 10);
    lngMainHeatEx = registerComponent(new THREE.Mesh(new THREE.BoxGeometry(9.0, 18.0, 7.0), matInsulatedBlue), "Main Cryogenic Heat Exchanger", "lngColdBox", "thermal", new THREE.Vector3(0, 21, 0));
    lngMainHeatEx.position.set(0, 9.8, 0);

    addPedestal(14, 0, 8, 8);
    lngColdSurge = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 10.0, 32), matStainless), "LNG Cryogenic Surge Drum", "lngSurge", "tank", new THREE.Vector3(14, 12, 0));
    lngColdSurge.position.set(14, 5.8, 0);

    addPedestal(0, 14, 12, 8, 0.8);
    lngRefrigCompressor = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.5, 9.0, 24), matDarkCompressor), "Refrigerant Turbine Compressor", "lngCompressor", "machinery", new THREE.Vector3(0, 7, 14));
    lngRefrigCompressor.rotation.z = Math.PI / 2;
    lngRefrigCompressor.position.set(0, 3.2, 14);

    addPedestal(18, -10, 10, 10);
    registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 12.0, 32), matProductTank), "Cryogenic LNG Final Product Tank", "lngStorage", "tank", new THREE.Vector3(18, 14, -10), true);
    finalProductStorageTank.position.set(18, 6.8, -10);

    createPipingSegment([ new THREE.Vector3(-12, 22, -2), new THREE.Vector3(-12, 22, 0), new THREE.Vector3(-4.5, 22, 0) ], 0.45, 0x38bdf8, "feed");
    createPipingSegment([ new THREE.Vector3(4.5, 4.0, 0), new THREE.Vector3(14, 4.0, 0) ], 0.5, 0x0284c7, "cryo_lng");
    createPipingSegment([ new THREE.Vector3(0, 2.0, 3.5), new THREE.Vector3(0, 2.0, 9.5) ], 0.4, 0xeab308, "refrigerant");
    createPipingSegment([ new THREE.Vector3(4.5, 3.2, 14), new THREE.Vector3(7.0, 3.2, 14), new THREE.Vector3(7.0, 14.0, 0), new THREE.Vector3(4.5, 14.0, 0) ], 0.4, 0xef4444, "refrig_return");
    createPipingSegment([ new THREE.Vector3(14, 8, 0), new THREE.Vector3(18, 12, -10) ], 0.45, 0x22c55e, "product_output");
}

// 3. HYDROGEN FACILITY
let h2Furnace, h2ShiftConverter, h2HeatExchanger, h2PsaTower;
function buildHydrogenFacility() {
    clearCurrentFacility();
    const matFurnaceRefractory = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.3, roughness: 0.7 });
    const matReactorSteel = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.85, roughness: 0.25 });
    const matPsaWhite = new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.2, roughness: 0.3 });
    const matProductTank = new THREE.MeshStandardMaterial({ color: 0x14532d, metalness: 0.5, roughness: 0.3 });

    addPedestal(-14, 0, 14, 12, 1.0);
    h2Furnace = registerComponent(new THREE.Mesh(new THREE.BoxGeometry(11.0, 16.0, 9.0), matFurnaceRefractory), "Steam Methane Reformer Furnace", "h2Furnace", "thermal", new THREE.Vector3(-14, 19, 0));
    h2Furnace.position.set(-14, 9.0, 0);

    for (let xOff of [-3, 3]) {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 10, 16), matReactorSteel);
        stack.position.set(-14 + xOff, 22, 0);
        plantGroup.add(stack);
    }

    addPedestal(0, -6, 9, 9);
    h2ShiftConverter = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 16.0, 32), matReactorSteel), "Water-Gas Shift Converter", "h2Wgs", "vessel", new THREE.Vector3(0, 18, -6));
    h2ShiftConverter.position.set(0, 9.2, -6);

    addPedestal(-2, 8, 8, 6, 0.8);
    h2HeatExchanger = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 7.5, 24), matReactorSteel), "Syngas Heat Exchanger", "h2Exchanger", "thermal", new THREE.Vector3(-2, 6, 8));
    h2HeatExchanger.rotation.z = Math.PI / 2;
    h2HeatExchanger.position.set(-2, 3.0, 8);

    addPedestal(10, 0, 9, 9);
    h2PsaTower = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 20.0, 32), matPsaWhite), "PSA Hydrogen Vessel", "h2Psa", "vessel", new THREE.Vector3(10, 22, 0));
    h2PsaTower.position.set(10, 11.2, 0);

    addPedestal(24, 4, 10, 10);
    registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(4.0, 4.0, 12.0, 32), matProductTank), "Purified H2 High-Pressure Receiver", "h2Storage", "tank", new THREE.Vector3(24, 14, 4), true);
    finalProductStorageTank.position.set(24, 6.8, 4);

    createPipingSegment([ new THREE.Vector3(-8.5, 12, 0), new THREE.Vector3(-4, 12, 0), new THREE.Vector3(-4, 12, -6), new THREE.Vector3(-3.5, 12, -6) ], 0.45, 0xef4444, "syngas_hot");
    createPipingSegment([ new THREE.Vector3(0, 2.5, -6), new THREE.Vector3(0, 2.5, 8), new THREE.Vector3(-5.75, 2.5, 8) ], 0.4, 0xf97316, "syngas_shift");
    createPipingSegment([ new THREE.Vector3(1.75, 3.0, 8), new THREE.Vector3(6.0, 3.0, 8), new THREE.Vector3(6.0, 3.0, 0), new THREE.Vector3(7.0, 3.0, 0) ], 0.4, 0x38bdf8, "h2_raw");
    createPipingSegment([ new THREE.Vector3(10, 21.2, 0), new THREE.Vector3(17.0, 21.2, 0), new THREE.Vector3(24.0, 12, 4) ], 0.35, 0x22c55e, "h2_pure");
}

// 4. GASOLINE FACILITY
let gasCrackerReactor, gasFractionatorColumn, gasHydrotreater, gasFurnace;
function buildGasolineFacility() {
    clearCurrentFacility();
    const matCrackerSteel = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.3 });
    const matSilverColumn = new THREE.MeshStandardMaterial({ color: 0xc084fc, metalness: 0.7, roughness: 0.2 });
    const matFurnaceOrange = new THREE.MeshStandardMaterial({ color: 0xb45309, metalness: 0.4, roughness: 0.6 });
    const matProductTank = new THREE.MeshStandardMaterial({ color: 0x14532d, metalness: 0.5, roughness: 0.3 });

    addPedestal(-16, 0, 12, 10);
    gasFurnace = registerComponent(new THREE.Mesh(new THREE.BoxGeometry(9.0, 12.0, 7.0), matFurnaceOrange), "Pre-Heat Fired Heater", "gasFurnace", "thermal", new THREE.Vector3(-16, 15, 0));
    gasFurnace.position.set(-16, 7.2, 0);

    addPedestal(-2, -4, 10, 10);
    gasCrackerReactor = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(4.2, 2.8, 20.0, 32), matCrackerSteel), "FCC Cracker Reactor", "gasCracker", "vessel", new THREE.Vector3(-2, 23, -4));
    gasCrackerReactor.position.set(-2, 11.2, -4);

    addPedestal(12, 0, 10, 10);
    gasFractionatorColumn = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(3.8, 3.8, 32.0, 32), matSilverColumn), "Gasoline Fractionation Column", "gasFractionator", "vessel", new THREE.Vector3(12, 35, 0));
    gasFractionatorColumn.position.set(12, 17.2, 0);

    addPedestal(-2, 10, 8, 8);
    gasHydrotreater = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 12.0, 32), matCrackerSteel), "Naphtha Hydrotreater", "gasHydrotreater", "vessel", new THREE.Vector3(-2, 15, 10));
    gasHydrotreater.position.set(-2, 7.2, 10);

    addPedestal(20, 8, 10, 10);
    registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 12.0, 32), matProductTank), "Refined Gasoline Blending Tank", "gasStorage", "tank", new THREE.Vector3(20, 14, 8), true);
    finalProductStorageTank.position.set(20, 6.8, 8);

    createPipingSegment([ new THREE.Vector3(-11.5, 6.0, 0), new THREE.Vector3(-6.2, 6.0, 0), new THREE.Vector3(-6.2, 6.0, -4), new THREE.Vector3(-4.5, 6.0, -4) ], 0.5, 0xef4444, "hot_crude");
    createPipingSegment([ new THREE.Vector3(-2, 18.0, -4), new THREE.Vector3(-2, 24.0, -4), new THREE.Vector3(12, 24.0, -4), new THREE.Vector3(12, 24.0, -3.8) ], 0.5, 0xf97316, "cracked_vapor");
    createPipingSegment([ new THREE.Vector3(12, 8.0, 3.8), new THREE.Vector3(12, 8.0, 10.0), new THREE.Vector3(0.8, 8.0, 10.0) ], 0.4, 0x38bdf8, "raw_gasoline");
    createPipingSegment([ new THREE.Vector3(12, 28, 0), new THREE.Vector3(20, 12, 8) ], 0.45, 0x22c55e, "product_output");
}

// 5. CRUDE OIL FACILITY
let cduColumn, cduPreheatFurnace, cduDesalter, cduResidueStorage;
function buildCrudeOilFacility() {
    clearCurrentFacility();
    const matRawSteel = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 });
    const matFurnaceRed = new THREE.MeshStandardMaterial({ color: 0x991b1b, metalness: 0.4, roughness: 0.6 });
    const matDarkOilTank = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.6, roughness: 0.4 });
    const matProductTank = new THREE.MeshStandardMaterial({ color: 0x14532d, metalness: 0.5, roughness: 0.3 });

    addPedestal(-16, 0, 12, 10);
    cduPreheatFurnace = registerComponent(new THREE.Mesh(new THREE.BoxGeometry(10.0, 14.0, 8.0), matFurnaceRed), "Crude Fired Furnace", "cduFurnace", "thermal", new THREE.Vector3(-16, 17, 0));
    cduPreheatFurnace.position.set(-16, 8.2, 0);

    addPedestal(-2, 0, 11, 11);
    cduColumn = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 34.0, 32), matRawSteel), "Atmospheric Distillation Tower", "cduTower", "vessel", new THREE.Vector3(-2, 36, 0));
    cduColumn.position.set(-2, 18.2, 0);

    addPedestal(-16, -12, 9, 9);
    cduDesalter = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 9.0, 32), matRawSteel), "Crude Desalter Unit", "cduDesalter", "vessel", new THREE.Vector3(-16, 8, -12));
    cduDesalter.rotation.z = Math.PI / 2;
    cduDesalter.position.set(-16, 4.2, -12);

    addPedestal(14, 0, 12, 12);
    cduResidueStorage = registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(6.0, 6.0, 10.0, 32), matDarkOilTank), "Atmospheric Residue Storage Tank", "cduTank", "tank", new THREE.Vector3(14, 12, 0));
    cduResidueStorage.position.set(14, 5.8, 0);

    addPedestal(14, 14, 10, 10);
    registerComponent(new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 12.0, 32), matProductTank), "Refined Distillate Product Tank", "cduStorage", "tank", new THREE.Vector3(14, 14, 14), true);
    finalProductStorageTank.position.set(14, 6.8, 14);

    createPipingSegment([ new THREE.Vector3(-11.5, 3.5, -12), new THREE.Vector3(-11.5, 3.5, 0), new THREE.Vector3(-21.0, 3.5, 0) ], 0.5, 0x1e293b, "raw_crude_oil");
    createPipingSegment([ new THREE.Vector3(-11.0, 6.0, 0), new THREE.Vector3(-6.5, 6.0, 0) ], 0.55, 0x991b1b, "heated_crude_oil");
    createPipingSegment([ new THREE.Vector3(-2, 2.5, 0), new THREE.Vector3(8.0, 2.5, 0) ], 0.6, 0x0f172a, "heavy_residue_oil");
    createPipingSegment([ new THREE.Vector3(-2, 28, 0), new THREE.Vector3(14, 12, 14) ], 0.45, 0x22c55e, "product_output");
}

function rebuildFacilityForChemical(chem) {
    if (chem === "Propane") buildPropaneFacility();
    else if (chem === "Methane") buildMethaneFacility();
    else if (chem === "Hydrogen") buildHydrogenFacility();
    else if (chem === "Gasoline") buildGasolineFacility();
    else if (chem === "Crude Oil") buildCrudeOilFacility();

    reset3DView();
}

// ------------------------------------------
// 🧪 THERMODYNAMIC SIMULATION ENGINE
// ------------------------------------------
const HYDROCARBON_SPECS = {
    "Propane": { pDesign: 800, pCritical: 1050, tDesign: 150, tCritical: 220, qDesign: 150, tntFactor: 0.50, state: "gas", product: "Sweetened High-Purity LPG" },
    "Methane": { pDesign: 950, pCritical: 1300, tDesign: -160, tCritical: 110, qDesign: 200, tntFactor: 0.40, state: "gas", product: "Liquefied Natural Gas (LNG - 99.2% Purity)" },
    "Hydrogen": { pDesign: 650, pCritical: 850, tDesign: 250, tCritical: 340, qDesign: 100, tntFactor: 1.50, state: "gas", product: "Ultra-Pure Hydrogen (99.99%)" },
    "Gasoline": { pDesign: 700, pCritical: 950, tDesign: 280, tCritical: 350, qDesign: 180, tntFactor: 0.45, state: "liquid", product: "Unleaded Motor Gasoline Blend" },
    "Crude Oil": { pDesign: 600, pCritical: 850, tDesign: 350, tCritical: 450, qDesign: 250, tntFactor: 0.35, state: "liquid", product: "Fractionated Petroleum Distillates" }
};

function runSimulation() {
    const flowInput = document.getElementById('chemQty');
    const pressInput = document.getElementById('chemPress');
    const tempInput = document.getElementById('chemTemp');

    if (!flowInput.value || !pressInput.value || !tempInput.value) {
        alert("⚠️ Telemetry Incomplete: Please provide numerical values for Flow Rate, Pressure, and Temperature.");
        return;
    }

    const flowVal = parseFloat(flowInput.value);
    const pressVal = parseFloat(pressInput.value);
    const tempVal = parseFloat(tempInput.value);

    if (isNaN(flowVal) || isNaN(pressVal) || isNaN(tempVal)) {
        alert("⚠️ Invalid Input: Numbers required for all process parameters.");
        return;
    }

    allComponents.forEach(c => {
        c.userData.alertState = 'NORMAL';
        c.material.color.setHex(c.userData.originalColor);
    });

    const spec = HYDROCARBON_SPECS[selectedChemical] || HYDROCARBON_SPECS["Propane"];
    const isLiquid = spec.state === "liquid";
    
    const statusBadge = document.getElementById('processStatusBadge');
    const descEl = document.getElementById('processDesc');
    const broadcastBtn = document.getElementById('broadcastActionBtn');
    const exportPdfBtn = document.getElementById('exportPdfBtn');
    const metricsDiv = document.getElementById('blastMetrics');
    const productMetricsDiv = document.getElementById('productMetrics');
    const productYieldDesc = document.getElementById('productYieldDesc');
    const breachLabel = document.getElementById('resBreachNode');

    const pRatio = pressVal / spec.pDesign;
    const tRatio = tempVal / spec.tDesign;
    const qRatio = flowVal / spec.qDesign;

    if (pressVal <= spec.pDesign && tempVal <= spec.tDesign && flowVal <= spec.qDesign) {
        statusBadge.innerText = "SAFE OPERATING ENVELOPE (SOE) ✅";
        statusBadge.className = "status-badge status-normal";
        
        primaryFocusComponent = finalProductStorageTank;
        if (finalProductStorageTank) {
            document.getElementById('defectTagName').innerText = finalProductStorageTank.userData.partName;
            document.getElementById('defectSensorTag').style.display = 'block';
            cinematicCameraSweep(finalProductStorageTank);
        }

        descEl.innerHTML = `
            ✅ <strong>NOMINAL PROCESS STATE:</strong> Operating at ${pressVal} psi, ${tempVal}&deg;F, and ${flowVal} MMSCFD. 
            Containment and mass balance are secure within design limits.
        `;

        const producedVolume = (flowVal * 0.92).toFixed(1);
        productYieldDesc.innerHTML = `Successfully produced <strong>${producedVolume} MMSCFD / Barrels/day</strong> of <strong>${spec.product}</strong>. Material continuously routed and stored in <strong>${finalProductStorageTank ? finalProductStorageTank.userData.partName : 'Final Product Tank'}</strong>.`;
        productMetricsDiv.style.display = 'block';

        if (finalProductStorageTank) {
            finalProductStorageTank.material.color.setHex(0x22c55e);
        }

        metricsDiv.style.display = 'none';
        broadcastBtn.style.display = 'none';
        exportPdfBtn.style.display = 'none';

        clearParticles();
        workflowStage = 0;

    } else {
        productMetricsDiv.style.display = 'none';
        if (finalProductStorageTank) {
            finalProductStorageTank.material.color.setHex(finalProductStorageTank.userData.originalColor);
        }

        let targetUnit = null;
        let engineeringFaultType = "";

        if (selectedChemical === "Propane") {
            if (tRatio > 1.3) { targetUnit = propReboiler; engineeringFaultType = "Reboiler Tube Rupture due to Thermal Stress"; }
            else if (pRatio > 1.2) { targetUnit = propExchanger; engineeringFaultType = "Lean/Rich Exchanger Gasket Hydrocarbon Flange Leak"; }
            else { targetUnit = propContactor; engineeringFaultType = "Amine Absorber Hydraulic Flooding & Gas Blowby"; }
        } else if (selectedChemical === "Methane") {
            if (pRatio > 1.25) { targetUnit = lngScrubColumn; engineeringFaultType = "Dehydration Shell Overpressure Fracture"; }
            else if (tRatio < 0.5) { targetUnit = lngMainHeatEx; engineeringFaultType = "MCHE Cold Box Freeze-up & Cryogenic Expansion Stress"; }
            else { targetUnit = lngRefrigCompressor; engineeringFaultType = "Compressor Dynamic Seal Mechanical Degradation"; }
        } else if (selectedChemical === "Hydrogen") {
            if (tRatio > 1.2) { targetUnit = h2Furnace; engineeringFaultType = "SMR Reformer Radiant Tube High-Temperature Creep Rupture"; }
            else if (pRatio > 1.2) { targetUnit = h2PsaTower; engineeringFaultType = "PSA Bed Valve Overpressure Fatigue & Hydrogen Embrittlement"; }
            else { targetUnit = h2ShiftConverter; engineeringFaultType = "WGS Catalyst Bed Exothermic Thermal Runaway"; }
        } else if (selectedChemical === "Gasoline") {
            if (tRatio > 1.15) { targetUnit = gasFurnace; engineeringFaultType = "Fired Heater Tube Coking & Flame Impingement Breach"; }
            else if (pRatio > 1.2) { targetUnit = gasCrackerReactor; engineeringFaultType = "FCC Reactor Catalyst Riser Overpressure Excursion"; }
            else { targetUnit = gasFractionatorColumn; engineeringFaultType = "Main Fractionator Column Tray Vapor Blowby"; }
        } else if (selectedChemical === "Crude Oil") {
            if (pRatio > 1.2) { targetUnit = cduColumn; engineeringFaultType = "CDU Column Bottoms High Pressure Flange Rupture & Liquid Crude Oil Release"; }
            else if (tRatio > 1.2) { targetUnit = cduPreheatFurnace; engineeringFaultType = "Preheat Furnace Crude Pass Coking & Liquid Hydrocarbon Leak"; }
            else { targetUnit = cduDesalter; engineeringFaultType = "Desalter Interface Valve Hydraulic Overpressure Breach"; }
        }

        let flashFraction = 0.0;
        if (tempVal > spec.tDesign) {
            flashFraction = Math.min(1.0, ((tempVal - spec.tDesign) * 0.0035) * (pressVal / 500));
        }

        const totalMassFlowKg = flowVal * 11.8;
        const flashVaporMassKg = totalMassFlowKg * flashFraction;
        const eqTNT = Math.max(10, flashVaporMassKg * spec.tntFactor * (pressVal / spec.pDesign));
        const red_m = Math.round(10.0 * Math.cbrt(eqTNT));
        const yellow_m = Math.round(red_m * 1.8);
        const green_m = Math.round(red_m * 2.8);

        if (pressVal < spec.pCritical && tempVal < spec.tCritical && (pRatio > 1.0 || tRatio > 1.0 || qRatio > 1.0)) {
            statusBadge.innerText = "MODERATE: TRANSIENT STRAIN ⚠️";
            statusBadge.className = "status-badge status-warning";

            targetUnit.userData.alertState = 'WARNING';
            primaryFocusComponent = targetUnit;

            document.getElementById('defectTagName').innerText = targetUnit.userData.partName;
            document.getElementById('defectSensorTag').style.display = 'block';
            cinematicCameraSweep(targetUnit);

            descEl.innerHTML = `
                ⚠️ <strong>MODERATE STRAIN DETECTED:</strong> Operating parameters exceed nominal threshold for <strong>${targetUnit.userData.partName}</strong>. 
                ${isLiquid ? 'Liquid hydrocarbon ground leak detected.' : 'Vapor release plume forming.'}<br><br>👉 <em>Deploy Emergency Safety Shutdown below.</em>
            `;
        } else {
            statusBadge.innerText = "SEVERE: CATASTROPHIC ESD 🚨";
            statusBadge.className = "status-badge status-critical";

            targetUnit.userData.alertState = 'CRITICAL';
            primaryFocusComponent = targetUnit;

            document.getElementById('defectTagName').innerText = targetUnit.userData.partName;
            document.getElementById('defectSensorTag').style.display = 'block';
            cinematicCameraSweep(targetUnit);

            descEl.innerHTML = `
                🚨 <strong>SEVERE CONTAINMENT BREACH:</strong> Autonomous logic detected <em>${engineeringFaultType}</em> at <strong>${targetUnit.userData.partName}</strong>. 
                Production halted. ${isLiquid ? 'High-pressure liquid oil jet breach & ground splatter risk!' : 'Rapid overpressure release!'} Flash Release: <strong>${flashVaporMassKg.toFixed(1)} kg/s</strong>.<br><br>👉 <em>Deploy Emergency Safety Shutdown below.</em>
            `;
        }

        metricsDiv.style.display = 'block';
        breachLabel.innerText = targetUnit.userData.partName;
        document.getElementById('resTNT').innerText = Math.round(eqTNT);
        document.getElementById('resRed').innerText = red_m;
        document.getElementById('resYellow').innerText = yellow_m;
        document.getElementById('resGreen').innerText = green_m;
        
        broadcastBtn.style.display = 'block';
        exportPdfBtn.style.display = 'none';

        createLeakParticles(targetUnit.position, pressVal >= spec.pCritical, isLiquid);
        workflowStage = 1;
    }
}

function triggerEmergencyBroadcast() {
    const btn = document.getElementById('broadcastActionBtn');
    btn.innerHTML = "✅ Emergency Safety Shutdown (ESD) Broadcasted to Control Room";
    btn.classList.remove('pulsing');
    btn.disabled = true;

    document.getElementById('exportPdfBtn').style.display = 'block';
    document.getElementById('processDesc').innerHTML += `<br><br>👉 <em>Emergency shutdown complete! View the interactive PDF Safety Report below.</em>`;

    workflowStage = 2;
}

// ------------------------------------------
// 📄 PDF REPORT GENERATION & PREVIEW
// ------------------------------------------
function previewSafetyReport() {
    const activeOperator = sessionStorage.getItem('auth_user') || 'Authorized Operator';
    const statusText = document.getElementById('processStatusBadge').innerText;
    const breachNode = document.getElementById('resBreachNode').innerText;
    const tntVal = document.getElementById('resTNT').innerText;
    const redM = document.getElementById('resRed').innerText;
    const yellowM = document.getElementById('resYellow').innerText;
    const greenM = document.getElementById('resGreen').innerText;
    const fullDiagDesc = document.getElementById('processDesc').innerText;

    const reportContent = document.createElement('div');
    reportContent.style.padding = '30px';
    reportContent.style.fontFamily = 'Arial, sans-serif';
    reportContent.style.color = '#0f172a';
    reportContent.style.background = '#ffffff';

    reportContent.innerHTML = `
        <div style="border-bottom: 3px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
            <div>
                <h1 style="margin:0; font-size: 20px; color: #0284c7;">3D REFINERY DIGITAL TWIN</h1>
                <h3 style="margin: 4px 0 0 0; font-size: 13px; color: #475569;">Official Safety Assessment & Emergency Incident Report</h3>
            </div>
            <div style="text-align: right; font-size: 11px; color: #64748b;">
                <strong>Incident Timestamp:</strong> ${new Date().toLocaleString()}<br>
                <strong>Command Operator:</strong> ${activeOperator}<br>
                <strong>System Token:</strong> SCADA-DT-2026
            </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px;">
            <tr style="background: #f1f5f9;">
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold;">Facility Processing Unit</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1;">${selectedChemical}</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold;">System Containment Status</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold; color: #dc2626;">${statusText}</td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold;">Operating Pressure</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1;">${document.getElementById('chemPress').value} psi</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold;">Process Temperature</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1;">${document.getElementById('chemTemp').value} °F</td>
            </tr>
            <tr style="background: #f1f5f9;">
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold;">Gas/Liquid Flow Rate</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1;">${document.getElementById('chemQty').value} MMSCFD</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold;">Breached Node Tag</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold; color: #dc2626;">${breachNode}</td>
            </tr>
            <tr>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold;">Emergency Dispatch Status</td>
                <td style="padding: 8px; border: 1px solid #5376a2; font-weight: bold; color: #16a34a;" colspan="3">
                    ✅ HAZMAT UNITS AND CRISIS RESPONSE TEAMS DEPLOYED
                </td>
            </tr>
            <tr style="background: #f1f5f9;">
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold;">Interlock Action</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold; color: #16a34a;" colspan="3">
                    Automated Emergency Safety Shutdown (ESD) Executed — Feed Valves Isolated
                </td>
            </tr>
        </table>

        <div style="background: #f8fafc; border-left: 4px solid #0284c7; padding: 12px; margin-bottom: 20px; border-radius: 4px; font-size: 11px; line-height: 1.6; color: #334155;">
            <h4 style="margin: 0 0 6px 0; color: #0284c7; font-size: 12px;">🔍 Incident Engineering & Diagnostic Summary</h4>
            ${fullDiagDesc}
        </div>

        <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 14px; margin-bottom: 20px; border-radius: 4px;">
            <h3 style="margin-top:0; color: #991b1b; font-size: 14px;">💥 Blast Yield & Containment Perimeter Assessment</h3>
            <p style="font-size: 12px; margin-bottom: 8px;"><strong>Calculated TNT Explosive Yield Equivalent:</strong> ${tntVal} kg TNT</p>
            <ul style="font-size: 12px; margin: 0; padding-left: 20px; color: #7f1d1d; line-height: 1.6;">
                <li><strong>🔴 Lethal Exclusion Zone (5.0 psi overpressure):</strong> ${redM} meters radius</li>
                <li><strong>🟡 Structural Hazard Perimeter (2.0 psi overpressure):</strong> ${yellowM} meters radius</li>
                <li><strong>🟢 Outer Safe Boundary (0.5 psi overpressure):</strong> ${greenM} meters radius</li>
            </ul>
        </div>

        <div style="font-size: 11px; color: #64748b; margin-top: 25px; border-top: 1px solid #e2e8f0; padding-top: 10px; text-align: center;">
            Generated automatically by SCADA Cyber-Physical Twin Engine. Confidential - Process Safety & Crisis Command.
        </div>
    `;

    document.body.appendChild(reportContent);

    const opt = {
        margin:       0.4,
        filename:     `Refinery_Safety_Report_${selectedChemical}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2 },
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(reportContent).output('blob').then(function(blob) {
        document.body.removeChild(reportContent);
        const blobUrl = URL.createObjectURL(blob);
        const iframe = document.getElementById('pdfIframe');
        if (iframe) {
            iframe.src = blobUrl;
            document.getElementById('pdfModalOverlay').style.display = 'flex';
        }
    }).catch(() => {
        if (document.body.contains(reportContent)) {
            document.body.removeChild(reportContent);
        }
    });
}

function closePdfModal() {
    const pdfOverlay = document.getElementById('pdfModalOverlay');
    if (pdfOverlay) pdfOverlay.style.display = 'none';
    const iframe = document.getElementById('pdfIframe');
    if (iframe) iframe.src = 'about:blank';
}

// ------------------------------------------
// 🎮 CAMERA & VIEWPORT CONTROLS
// ------------------------------------------
function adjustCameraZoom(delta) {
    if (!camera || !controls) return;
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    camera.position.addScaledVector(dir, delta);
}

function focusCriticalUnit() {
    if (!primaryFocusComponent && allComponents.length > 0) {
        primaryFocusComponent = allComponents.find(c => c.userData.alertState === 'WARNING' || c.userData.alertState === 'CRITICAL');
        if (!primaryFocusComponent) {
            primaryFocusComponent = allComponents[0];
        }
    }

    if (primaryFocusComponent && controls && camera) {
        const tagNameEl = document.getElementById('defectTagName');
        const tagContainerEl = document.getElementById('defectSensorTag');
        
        if (tagNameEl && tagContainerEl) {
            tagNameEl.innerText = primaryFocusComponent.userData.partName;
            tagContainerEl.style.display = 'block';
        }

        cinematicCameraSweep(primaryFocusComponent);
    } else {
        alert("⚠️ No facility components available to focus on.");
    }
}

function reset3DView() {
    if (controls && camera) {
        controls.target.set(0, 5, 0);
        camera.position.set(65, 40, 75);
    }
    clearParticles();
    isCameraTransitioning = false;
    
    document.getElementById('chemQty').value = '';
    document.getElementById('chemPress').value = '';
    document.getElementById('chemTemp').value = '';
    workflowStage = 0;

    document.getElementById('blastMetrics').style.display = 'none';
    document.getElementById('productMetrics').style.display = 'none';
    document.getElementById('processStatusBadge').className = 'status-badge status-normal';
    document.getElementById('processStatusBadge').innerText = 'Safe Operating Envelope';
    document.getElementById('processDesc').innerText = 'Supply operational parameters above to evaluate facility containment limits.';
    
    const broadcastBtn = document.getElementById('broadcastActionBtn');
    broadcastBtn.style.display = 'none';
    broadcastBtn.disabled = false;
    broadcastBtn.classList.add('pulsing');
    broadcastBtn.innerText = '📡 Dispatch Emergency Safety Shutdown (ESD)';

    document.getElementById('exportPdfBtn').style.display = 'none';
    document.getElementById('sensorTooltip').style.display = 'none';
    document.getElementById('defectSensorTag').style.display = 'none';

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

function updateLabels() {
    if (!camera) return;
    
    const isAuthenticated = sessionStorage.getItem('auth_token') !== null;
    const widthHalf = window.innerWidth / 2;
    const heightHalf = window.innerHeight / 2;

    labelObjects.forEach(item => {
        const el = document.getElementById(item.id);
        if (!el) return;

        if (!showLabels || !isAuthenticated) {
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

    const defectTagEl = document.getElementById('defectSensorTag');
    if (primaryFocusComponent && defectTagEl && defectTagEl.style.display === 'block') {
        const defectPos = primaryFocusComponent.position.clone().add(new THREE.Vector3(0, 4, 0));
        const vector = defectPos.project(camera);
        if (vector.z < 1) {
            defectTagEl.style.left = `${(vector.x * widthHalf) + widthHalf}px`;
            defectTagEl.style.top = `${-(vector.y * heightHalf) + heightHalf}px`;
            defectTagEl.style.display = 'block';
        } else {
            defectTagEl.style.display = 'none';
        }
    }
}

window.addEventListener('resize', () => {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------
// 🔄 RENDER LOOP WITH GLOW & TRANSITION LERP
// ------------------------------------------
function animate() {
    requestAnimationFrame(animate);

    if (isCameraTransitioning && controls && camera) {
        camera.position.lerp(targetCameraPos, 0.04);
        controls.target.lerp(targetControlsTarget, 0.04);

        if (camera.position.distanceTo(targetCameraPos) < 0.5) {
            isCameraTransitioning = false;
        }
    }

    if (controls && !isFpsMode && !isCameraTransitioning) {
        controls.autoRotate = autoRotate;
        controls.autoRotateSpeed = 1.0;
        controls.update();
    } else if (controls && !isFpsMode && isCameraTransitioning) {
        controls.update();
    }

    updateFPSMovement();
    updateParticles();

    allPipelines.forEach(p => {
        if (p.texture) p.texture.offset.x -= p.speed;
    });

    const time = Date.now() * 0.01;
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

    if (composer) {
        composer.render();
    } else if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }

    updateLabels();
}

window.addEventListener('DOMContentLoaded', () => {
    init3DScene();
    checkSessionOnLoad();
});
