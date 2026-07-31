// FILE: apps/web/src/router/index.ts
// PURPOSE: Hash-history router with auth guard; validates URL keys silently, redirects unauthenticated users to /auth.
// OWNS: route definitions, auth before-enter logic, deeplink intent saving
// EXPORTS: router (default)
// DOCS: .agents/reports/plan_auth-separate-page_2026-07-30.md

import { createRouter, createWebHashHistory } from '@ionic/vue-router';
import { RouteRecordRaw } from 'vue-router';
import HomePage from '../views/HomePage.vue'
import { getApiKey, setApiKey, clearApiKey, validateApiKey } from '../services/api'

const routes: Array<RouteRecordRaw> = [
    {
        path: '/',
        redirect: '/home'
    },
    {
        path: '/home',
        name: 'Home',
        component: HomePage
    },
    {
        path: '/home/:botId/:userId?',
        name: 'HomeChat',
        component: HomePage,
        props: true
    },
    {
        path: '/:botId/:userId?',
        name: 'Chat',
        component: HomePage,
        props: true
    },
    {
        path: '/auth',
        name: 'Auth',
        component: () => import('../views/AuthPage.vue')
    }
]

const router = createRouter({
    history: createWebHashHistory(import.meta.env.BASE_URL),
    routes
})

// Fix for double hash issue - resolve the actual hash
router.resolve = ((originalResolve) => {
    return (to: any) => {
        const resolved = originalResolve.call(router, to);
        if (resolved.href && resolved.href.includes('#')) {
            const parts = resolved.href.split('#');
            if (parts.length > 2) {
                resolved.href = parts[0] + '#' + parts[parts.length - 1];
            }
        }
        return resolved;
    };
})(router.resolve);

// Auth guard — runs before every navigation
router.beforeEach(async (to) => {
    // 1. If navigating to /auth: allow only if no key stored; redirect away if already authenticated
    if (to.name === 'Auth') {
        if (getApiKey()) return '/home';
        return true;
    }

    // 2. Valid key in localStorage → allow immediately
    if (getApiKey()) return true;

    // 3. Check URL query for api_key / apiKey (shared-link scenario)
    const urlKey = (to.query.api_key as string) || (to.query.apiKey as string);
    if (urlKey) {
        setApiKey(urlKey);
        const result = await validateApiKey();
        if (result.ok) {
            // Valid URL key — clean the key from the URL and proceed
            const cleanQuery: Record<string, any> = {};
            for (const [k, v] of Object.entries(to.query)) {
                if (k !== 'api_key' && k !== 'apiKey') {
                    cleanQuery[k] = v;
                }
            }
            return { path: to.path, query: cleanQuery, params: to.params, replace: true };
        } else {
            // Invalid URL key — clear everything, save intended route, redirect to /auth with error
            clearApiKey();
            if (to.name !== 'Home') {
                // Sanitize intended route: strip api_key/apiKey so user isn't sent back to a URL with the bad key
                const cleanQuery = { ...to.query };
                delete cleanQuery.api_key;
                delete (cleanQuery as any).apiKey;
                const cleanRoute = router.resolve({ path: to.path, query: cleanQuery });
                sessionStorage.setItem('intendedRoute', cleanRoute.href);
            }
            return { path: '/auth', query: { reason: 'invalid_url_key' } };
        }
    }

    // 4. No key anywhere — save intended route (unless it's just Home) and redirect to /auth
    if (to.name !== 'Home') {
        sessionStorage.setItem('intendedRoute', to.fullPath);
    }
    return '/auth';
});

export default router
