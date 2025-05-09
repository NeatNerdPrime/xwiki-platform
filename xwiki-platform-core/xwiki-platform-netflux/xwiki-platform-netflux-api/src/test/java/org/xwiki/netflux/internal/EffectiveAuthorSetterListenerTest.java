/*
 * See the NOTICE file distributed with this work for additional
 * information regarding copyright ownership.
 *
 * This is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as
 * published by the Free Software Foundation; either version 2.1 of
 * the License, or (at your option) any later version.
 *
 * This software is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this software; if not, write to the Free
 * Software Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA
 * 02110-1301 USA, or see the FSF site: http://www.fsf.org.
 */
package org.xwiki.netflux.internal;

import java.util.Locale;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.xwiki.bridge.event.ActionExecutingEvent;
import org.xwiki.container.Container;
import org.xwiki.container.Request;
import org.xwiki.model.reference.AttachmentReference;
import org.xwiki.model.reference.DocumentReference;
import org.xwiki.netflux.internal.EntityChange.ScriptLevel;
import org.xwiki.test.junit5.mockito.ComponentTest;
import org.xwiki.test.junit5.mockito.InjectMockComponents;
import org.xwiki.test.junit5.mockito.MockComponent;
import org.xwiki.user.UserReference;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link EffectiveAuthorSetterListener}.
 *
 * @version $Id$
 */
@ComponentTest
class EffectiveAuthorSetterListenerTest
{
    @InjectMockComponents
    private EffectiveAuthorSetterListener listener;

    @MockComponent
    private EntityChannelScriptAuthorTracker scriptAuthorTracker;

    @MockComponent
    private Container container;

    @Mock
    private Request request;

    @Mock
    private UserReference effectiveAuthor;

    @BeforeEach
    void beforeEach()
    {
        when(this.container.getRequest()).thenReturn(this.request);
    }

    @Test
    void onActionExecutingEvent() throws Exception
    {
        DocumentReference documentReference = new DocumentReference("test", "Some", "Page");
        UserReference otherUserReference = mock(UserReference.class);
        // An entity change that targets some document, with an older timestamp.
        EntityChange entityChangeTwo =
            new EntityChange(new DocumentReference("test", "Other", "Page"), otherUserReference, ScriptLevel.SCRIPT);
        // Wait a bit to be sure that the next entity changes have a newer timestamp.
        Thread.sleep(10);
        // An entity change that targets a document translation, with a higher script level.
        EntityChange entityChangeThree = new EntityChange(new DocumentReference(documentReference, Locale.FRENCH),
            otherUserReference, ScriptLevel.PROGRAMMING);
        // An entity change that targets a document attachment, with a lower script level (same as the first change, but
        // with a more recent timestamp). The lower script level with the recent timestamp should win.
        EntityChange entityChangeFour = new EntityChange(new AttachmentReference("file.txt", documentReference),
            this.effectiveAuthor, ScriptLevel.SCRIPT);
        // Wait a bit to be sure that the next entity changes have a newer timestamp.
        Thread.sleep(10);
        EntityChange entityChangeFive = new EntityChange(new DocumentReference("test", "Other", "Page"),
            otherUserReference, ScriptLevel.PROGRAMMING);

        when(this.request.getParameterValues("netfluxChannel"))
            .thenReturn(new String[] {"", "one", null, "two", "three", "four", "five"});
        when(this.scriptAuthorTracker.getScriptAuthor("two")).thenReturn(Optional.of(entityChangeTwo));
        when(this.scriptAuthorTracker.getScriptAuthor("three")).thenReturn(Optional.of(entityChangeThree));
        when(this.scriptAuthorTracker.getScriptAuthor("four")).thenReturn(Optional.of(entityChangeFour));
        when(this.scriptAuthorTracker.getScriptAuthor("five")).thenReturn(Optional.of(entityChangeFive));

        this.listener.onEvent(new ActionExecutingEvent(), null, null);

        verify(this.request).setAttribute(Request.ATTRIBUTE_EFFECTIVE_AUTHOR, this.effectiveAuthor);
    }

    @Test
    void onActionExecutingEventWithoutNetfluxChannel()
    {
        this.listener.onEvent(new ActionExecutingEvent(), null, null);

        verify(this.request, never()).setAttribute(eq(Request.ATTRIBUTE_EFFECTIVE_AUTHOR), any(UserReference.class));
    }
}
